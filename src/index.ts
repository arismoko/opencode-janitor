/**
 * The Janitor — OpenCode plugin entry point.
 *
 * Wires commit detection → review orchestration → result delivery.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from '@opencode-ai/plugin';
import { loadConfig } from './config/loader';
import { CommitDetector } from './git/commit-detector';
import {
  getCommitContext,
  getWorkspaceCommitContext,
} from './git/commit-resolver';
import {
  getCurrentPrFromGh,
  getPrByNumberFromGh,
  isGhAvailable,
  postPrReviewWithGh,
} from './git/gh-pr';
import {
  getPrContext,
  getWorkspacePrContext,
  type PrContext,
} from './git/pr-context-resolver';
import { PrDetector } from './git/pr-detector';
import { resolveGitDir } from './git/repo-locator';
import { HistoryStore } from './history/store';
import { createHunterAgent } from './review/hunter-agent';
import { createJanitorAgent } from './review/janitor-agent';
import { buildReviewPrompt } from './review/prompt-builder';
import { ReviewRunQueue } from './review/review-run-queue';
import { spawnReview } from './review/runner';
import { HunterStrategy } from './review/strategies/hunter-strategy';
import { JanitorStrategy } from './review/strategies/janitor-strategy';
import { RuntimeStateStore } from './state/store';
import { buildSuppressionsBlock } from './suppressions/prompt';
import { SuppressionStore } from './suppressions/store';
import { atomicWriteSync } from './utils/atomic-write';
import { appendEvent } from './utils/event-log';
import { log, warn } from './utils/logger';
import { injectMessage } from './utils/notifier';
import {
  branchKey,
  commitKey,
  extractHeadSha,
  prKey,
  workspaceKey,
} from './utils/review-key';
import { ensureStateDir, resolveStateDir } from './utils/state-dir';

/** Plugin return shape — typed locally since the SDK Plugin type doesn't
 *  export a precise return interface for hooks we use. */
interface JanitorPluginReturn {
  name: string;
  config?: (config: Record<string, unknown>) => Promise<void>;
  'command.execute.before'?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Array<{ type: string; text?: string }> },
  ) => Promise<void>;
  'tool.execute.after'?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ) => Promise<void>;
  event?: (input: {
    event: { type: string; properties?: Record<string, unknown> };
  }) => Promise<void>;
}

let stopActiveRuntime: (() => Promise<void>) | null = null;

/** Best-effort toast — swallows errors so it never breaks init. */
function toast(ctx: Parameters<Plugin>[0], message: string) {
  try {
    (ctx.client as any).tui
      ?.showToast?.({ body: { message, variant: 'info' } })
      .catch(() => {});
  } catch {
    // TUI may not be available
  }
}

type TriggerMode = 'commit' | 'pr' | 'both' | 'never';

function triggerMatches(trigger: TriggerMode, mode: 'commit' | 'pr'): boolean {
  if (trigger === 'never') return false;
  return trigger === mode || trigger === 'both';
}

const TheJanitor: Plugin = async (ctx) => {
  const config = loadConfig(ctx.directory);
  if (stopActiveRuntime) {
    await stopActiveRuntime();
    stopActiveRuntime = null;
  }

  if (!config.enabled) {
    log('disabled by config');
    toast(ctx, 'Janitor: disabled by config');
    return { name: 'the-janitor' } as JanitorPluginReturn;
  }

  // Bridge ctx.$ to the exec(cmd) => string interface our modules expect.
  // Uses { raw } to prevent Bun's shell from escaping the command as a
  // single token — without this, "git log -1" would be treated as one
  // executable name instead of "git" with arguments "log" and "-1".
  //
  // No .nothrow() — git failures must propagate so callers' try/catch
  // blocks can take their intended error paths (e.g. repo-locator fallback).
  const exec = async (cmd: string): Promise<string> => {
    // Pin all git commands to the workspace directory so they don't
    // depend on process cwd, which may differ from the project root.
    // Shell-quote the directory so paths with spaces/metacharacters
    // are passed as a single argument to git -C.
    const quoted = `'${ctx.directory.replace(/'/g, "'\\''")}'`;
    const pinned = cmd.startsWith('git ')
      ? `git -C ${quoted} ${cmd.slice(4)}`
      : cmd;
    const result = await ctx.$`${{ raw: pinned }}`.quiet().text();
    return result;
  };

  let gitDir: string;
  try {
    gitDir = await resolveGitDir(ctx.directory, exec);
  } catch {
    warn(`no git repo at ${ctx.directory} — janitor inactive`);
    toast(ctx, `Janitor: no git repo found — inactive`);
    return { name: 'the-janitor' } as JanitorPluginReturn;
  }

  const janitorAgent = createJanitorAgent(config);
  const hunterAgent = createHunterAgent(config);

  const janitorCommitEnabled =
    config.agents.janitor.enabled &&
    triggerMatches(config.agents.janitor.trigger, 'commit');
  const janitorPrEnabled =
    config.agents.janitor.enabled &&
    triggerMatches(config.agents.janitor.trigger, 'pr');
  const hunterCommitEnabled =
    config.agents.hunter.enabled &&
    triggerMatches(config.agents.hunter.trigger, 'commit');
  const hunterPrEnabled =
    config.agents.hunter.enabled &&
    triggerMatches(config.agents.hunter.trigger, 'pr');

  const anyCommitReviews = janitorCommitEnabled || hunterCommitEnabled;
  const anyPrReviews = janitorPrEnabled || hunterPrEnabled;

  const ghAvailableAtStartup = anyPrReviews ? await isGhAvailable(exec) : false;
  if (anyPrReviews && !ghAvailableAtStartup) {
    warn(
      '[init] gh CLI not available — PR reviews will fall back to session/toast/file delivery',
    );
  }

  const store = new RuntimeStateStore(ctx.directory);
  const runtime = { disposed: false };

  // XDG state directory for session event logs
  const stateDir = resolveStateDir(ctx.directory);
  ensureStateDir(stateDir);
  const trackedSessions = new Set<string>();

  /** Write session metadata JSON alongside the JSONL event log. */
  const writeSessionMeta = (
    sessionId: string,
    meta: {
      title: string;
      agent: string;
      key: string;
      status: string;
      startedAt: number;
      completedAt?: number;
    },
  ) => {
    atomicWriteSync(
      join(stateDir, `${sessionId}.json`),
      JSON.stringify(
        { id: sessionId, workspaceDir: ctx.directory, ...meta },
        null,
        2,
      ),
    );
  };

  const paused = store.getPaused();
  const control = {
    pausedJanitor: paused.janitor,
    pausedHunter: paused.hunter,
  };
  const suppressionStore = new SuppressionStore(ctx.directory, {
    maxEntries: config.suppressions?.maxEntries,
  });
  const historyStore = new HistoryStore(ctx.directory, {
    maxReviews: config.history?.maxReviews,
    maxBytes: config.history?.maxBytes,
  });

  // Seed detector with previously processed SHAs
  const previouslyProcessed = store.getProcessed();
  const previouslyProcessedPrKeys = store.getProcessedPrKeys();

  // Orchestrator handles queuing and review lifecycle
  const janitorStrategy = new JanitorStrategy(suppressionStore, historyStore);
  const orchestrator = new ReviewRunQueue<
    string,
    import('./types').ReviewResult
  >(
    config,
    async (runKey) => {
      const workspace = runKey.startsWith('workspace:');
      const commit = workspace
        ? await getWorkspaceCommitContext(config, exec)
        : await getCommitContext(runKey, config, exec);

      // Hollow review guard: reject commits with no meaningful diff content.
      // This prevents wasted review cycles and misleading "all clean" results
      // when git commands failed silently or the commit is truly empty.
      if (!commit.patch.trim() && commit.changedFiles.length === 0) {
        throw new Error(
          `Empty commit context for ${commit.sha.slice(0, 8)} — no patch or changed files`,
        );
      }

      const suppressionsBlock = config.suppressions?.enabled
        ? buildSuppressionsBlock(
            suppressionStore.getActive(),
            config.suppressions?.maxPromptBytes,
          )
        : '';
      const prompt = buildReviewPrompt(
        {
          label: `${commit.sha.slice(0, 8)} — ${commit.subject}`,
          changedFiles: commit.changedFiles,
          patch: commit.patch,
          patchTruncated: commit.patchTruncated,
          metadata: [
            `SHA: ${commit.sha}`,
            `Subject: ${commit.subject}`,
            `Parents: ${commit.parents.join(' ')}`,
          ],
        },
        {
          maxFindings: config.model.maxFindings,
          scopeInclude: config.scope.include,
          scopeExclude: config.scope.exclude,
          suppressionsBlock,
        },
      );

      const sessionId = await spawnReview(ctx, {
        prompt,
        title: `[janitor-run] ${runKey}`,
        agent: 'janitor',
        modelId: config.agents.janitor.modelId ?? config.model.id,
      });
      trackedSessions.add(sessionId);
      writeSessionMeta(sessionId, {
        title: `[janitor-run] ${runKey}`,
        agent: 'janitor',
        key: runKey,
        status: 'running',
        startedAt: Date.now(),
      });
      return sessionId;
    },
    janitorStrategy,
    'orchestrator',
  );

  // Persist SHA only after review completes successfully
  orchestrator.onCompleted((sha) => {
    if (sha.startsWith('workspace:')) return;
    store.add(sha);
    log(`persisted reviewed commit: ${sha}`);
  });

  // Give orchestrator access to the SDK client for error injection
  orchestrator.setContext(ctx);

  const hunterStrategy = new HunterStrategy(
    async (prNumber: number, body: string) => {
      if (!(await isGhAvailable(exec))) return false;
      return postPrReviewWithGh(exec, prNumber, body);
    },
  );
  const hunterOrchestrator = new ReviewRunQueue<
    PrContext,
    import('./types').HunterResult
  >(
    config,
    async (prContext: PrContext) => {
      const id = prContext.number ? `PR #${prContext.number}` : prContext.key;
      const prompt = buildReviewPrompt(
        {
          label: id,
          changedFiles: prContext.changedFiles,
          patch: prContext.patch,
          patchTruncated: prContext.patchTruncated,
          metadata: [
            `Base: ${prContext.baseRef}`,
            `Head: ${prContext.headRef}`,
            `Head SHA: ${prContext.headSha}`,
          ],
        },
        {
          maxFindings: config.model.maxFindings,
          scopeInclude: config.scope.include,
          scopeExclude: config.scope.exclude,
        },
      );

      const sessionId = await spawnReview(ctx, {
        prompt,
        title: `[hunter-run] ${prContext.key}`,
        agent: 'bug-hunter',
        modelId: config.agents.hunter.modelId ?? config.model.id,
      });
      trackedSessions.add(sessionId);
      writeSessionMeta(sessionId, {
        title: `[hunter-run] ${prContext.key}`,
        agent: 'bug-hunter',
        key: prContext.key,
        status: 'running',
        startedAt: Date.now(),
      });
      return sessionId;
    },
    hunterStrategy,
    'hunter-orchestrator',
  );
  hunterOrchestrator.setContext(ctx);
  hunterOrchestrator.onCompleted((key: string) => {
    if (key.startsWith('workspace:')) return;
    store.addPrKey(key);
    const headSha = extractHeadSha(key);
    if (headSha) {
      store.addProcessedHunterHead(headSha);
    }
    log(`persisted reviewed PR key: ${key}`);
  });

  const hasHunterHeadInFlight = (headSha: string): boolean => {
    return hunterOrchestrator.getJobsSnapshot().some((job) => {
      if (
        job.status !== 'pending' &&
        job.status !== 'starting' &&
        job.status !== 'running'
      ) {
        return false;
      }
      return extractHeadSha(job.key) === headSha;
    });
  };

  // Commit detector
  const detector = new CommitDetector(
    async () => {
      const result = await ctx.$`git -C ${ctx.directory} rev-parse HEAD`
        .quiet()
        .nothrow()
        .text();
      return result.trim();
    },
    async (sha, signal) => {
      if (runtime.disposed) return;
      log(`new commit detected: ${sha} via ${signal.source}`);

      if (janitorCommitEnabled) {
        if (!control.pausedJanitor) {
          if (runtime.disposed) return;
          orchestrator.enqueue(sha);
        }
      }

      if (hunterCommitEnabled) {
        if (control.pausedHunter) {
          return;
        }
        if (runtime.disposed) return;
        if (hasHunterHeadInFlight(sha)) {
          log(
            `[hunter] skipping commit-triggered in-flight duplicate: ${sha.slice(0, 8)}`,
          );
          return;
        }
        if (store.hasProcessedHunterHead(sha)) {
          log(
            `[hunter] skipping commit-triggered duplicate for processed head: ${sha.slice(0, 8)}`,
          );
          return;
        }
        const commit = await getCommitContext(sha, config, exec);

        if (!commit.patch.trim() && commit.changedFiles.length === 0) {
          warn(`[hunter] skipping empty commit context: ${sha.slice(0, 8)}`);
        } else {
          hunterOrchestrator.enqueue({
            key: commitKey(sha),
            headSha: sha,
            baseRef: commit.parents[0] ?? config.pr.baseBranch,
            headRef: sha,
            changedFiles: commit.changedFiles,
            patch: commit.patch,
            patchTruncated: commit.patchTruncated,
          });
        }
      }
    },
    config.autoReview.debounceMs,
    config.autoReview.pollFallbackSec,
  );

  let branchPushPending = false;

  const prDetector = anyPrReviews
    ? new PrDetector(
        async () => {
          if (ghAvailableAtStartup) {
            const ghPr = await getCurrentPrFromGh(exec);
            if (!ghPr) return null;
            return prKey(ghPr.number, ghPr.headSha);
          }

          // No gh available — only react after an observed push command.
          if (!branchPushPending) return null;

          const branch = (await exec('git rev-parse --abbrev-ref HEAD')).trim();
          if (!branch || branch === 'HEAD') return null;

          const headSha = (await exec('git rev-parse HEAD')).trim();
          if (!headSha) return null;

          return branchKey(branch, headSha);
        },
        async (key, signal) => {
          if (runtime.disposed) return;
          log(`new PR state detected: ${key} via ${signal.source}`);

          let prContext: PrContext;

          if (key.startsWith('pr:')) {
            // Parse the detected key to get the exact PR number and SHA
            // that getCurrentKey resolved. The callback MUST use these
            // values (or validate a re-fetch matches) to ensure verify()
            // commits the correct key as processed.
            const [, prNumStr, detectedSha] = key.split(':');
            const detectedPrNum = Number(prNumStr);

            // Re-fetch to get baseRef/headRef (not encoded in the key),
            // but validate the re-fetch matches the detected state.
            const ghPr = await getCurrentPrFromGh(exec);
            if (!ghPr) {
              // PR was open when getCurrentKey ran but is now gone.
              // Log and return — key is already marked processed by verify().
              warn(`PR disappeared between detection and callback: ${key}`);
              return;
            }

            if (ghPr.number !== detectedPrNum || ghPr.headSha !== detectedSha) {
              // PR state advanced between detection and re-fetch.
              // Log and return — the new state will be picked up as a new key.
              warn(
                `PR state changed between detection and callback: key=${key} but re-fetch got pr:${ghPr.number}:${ghPr.headSha}`,
              );
              return;
            }

            prContext = await getPrContext({
              baseRef: ghPr.baseRef,
              headRef: ghPr.headRef,
              headSha: ghPr.headSha,
              number: ghPr.number,
              config,
              exec,
            });
          } else {
            const branch = (
              await exec('git rev-parse --abbrev-ref HEAD')
            ).trim();
            if (!branch || branch === 'HEAD') return;

            const headSha = (await exec('git rev-parse HEAD')).trim();
            if (!headSha) return;

            prContext = await getPrContext({
              baseRef: config.pr.baseBranch,
              headRef: branch,
              headSha,
              config,
              exec,
            });

            branchPushPending = false;
          }

          if (!prContext.patch.trim() && prContext.changedFiles.length === 0) {
            warn(`[pr] skipping empty PR context: ${prContext.key}`);
            return;
          }

          // Persist observed PR key immediately to avoid restart re-triggers
          // while a review is still running.
          if (!store.hasProcessedPrKey(prContext.key)) {
            store.addPrKey(prContext.key);
          }

          if (janitorPrEnabled) {
            if (!control.pausedJanitor) {
              if (runtime.disposed) return;
              if (
                janitorCommitEnabled &&
                store.hasProcessedSha(prContext.headSha)
              ) {
                log(
                  `[janitor] skipping PR-triggered duplicate for processed SHA: ${prContext.headSha.slice(0, 8)}`,
                );
              } else {
                orchestrator.enqueue(prContext.headSha);
              }
            }
          }

          if (hunterPrEnabled) {
            if (!control.pausedHunter) {
              if (runtime.disposed) return;
              if (hasHunterHeadInFlight(prContext.headSha)) {
                log(
                  `[hunter] skipping PR-triggered in-flight duplicate: ${prContext.headSha.slice(0, 8)}`,
                );
                return;
              }
              if (store.hasProcessedHunterHead(prContext.headSha)) {
                log(
                  `[hunter] skipping PR-triggered duplicate for processed head: ${prContext.headSha.slice(0, 8)}`,
                );
                return;
              }
              hunterOrchestrator.enqueue(prContext);
            }
          }
        },
        config.autoReview.debounceMs,
        config.pr.pollSec,
      )
    : null;

  // Pre-seed processed SHAs so restarts don't re-review old commits
  if (janitorCommitEnabled) {
    for (const sha of previouslyProcessed) {
      detector.markProcessed(sha);
    }
  }

  if (anyCommitReviews) {
    await detector.start(gitDir);
  }

  if (prDetector) {
    for (const key of previouslyProcessedPrKeys) {
      prDetector.markProcessed(key);
    }
    prDetector.start();
  }

  stopActiveRuntime = async () => {
    runtime.disposed = true;
    detector.stop();
    prDetector?.stop();
    orchestrator.shutdown();
    hunterOrchestrator.shutdown();
    orchestrator.clearPending();
    hunterOrchestrator.clearPending();
    await orchestrator.abortRunning(ctx);
    await hunterOrchestrator.abortRunning(ctx);
    log('plugin runtime stopped: detectors halted');
  };

  toast(ctx, 'Janitor: watchers active');
  log(`initialized — watching ${gitDir}`);

  return {
    name: 'the-janitor',

    // Register janitor + hunter agents in OpenCode's agent registry.
    // Plugins must mutate the config object in place — the return value
    // of the config hook is ignored.
    config: async (opencodeConfig: Record<string, unknown>) => {
      const agents = (opencodeConfig.agent ?? {}) as Record<string, unknown>;

      for (const agent of [janitorAgent, hunterAgent]) {
        agents[agent.name] = {
          ...agent.config,
          description: agent.description,
        };
      }

      const commands = (opencodeConfig.command ?? {}) as Record<
        string,
        { description?: string; template?: string }
      >;
      commands.janitor = {
        description:
          'Janitor control: /janitor status|stop|resume [janitor|hunter|all], /janitor clean, /janitor review [pr#]',
        template: '',
      };
      opencodeConfig.command = commands;

      opencodeConfig.agent = agents;
      log("registered agents 'janitor' and 'bug-hunter' in config hook");
    },

    'command.execute.before': async (
      hookInput: { command: string; sessionID: string; arguments: string },
      _output: { parts: Array<{ type: string; text?: string }> },
    ) => {
      if (runtime.disposed) return;
      if (hookInput.command !== 'janitor') return;

      // Workaround until opencode supports hook-level short-circuiting for
      // command.execute.before without throwing.
      // Reference: https://github.com/anomalyco/opencode/pull/9307
      const handled = (): never => {
        throw new Error('__handled__');
      };

      const args = hookInput.arguments.trim().split(/\s+/).filter(Boolean);
      const action = (args[0] ?? 'status').toLowerCase();
      const target = (args[1] ?? 'all').toLowerCase();
      const usage =
        'Usage: /janitor status | /janitor stop|resume [janitor|hunter|all] | /janitor clean | /janitor review [pr#]';

      const respond = async (text: string) =>
        injectMessage(ctx, hookInput.sessionID, text, true);

      const renderJobs = () => {
        const janitorJobs = orchestrator.getJobsSnapshot();
        const hunterJobs = hunterOrchestrator.getJobsSnapshot();
        const janitorRunning = janitorJobs.filter(
          (j) => j.status === 'running',
        );
        const janitorPending = janitorJobs.filter(
          (j) => j.status === 'pending',
        );
        const hunterRunning = hunterJobs.filter((j) => j.status === 'running');
        const hunterPending = hunterJobs.filter((j) => j.status === 'pending');

        return [
          `paused: janitor=${control.pausedJanitor}, hunter=${control.pausedHunter}`,
          `jobs: janitor running=${janitorRunning.length}, pending=${janitorPending.length}; hunter running=${hunterRunning.length}, pending=${hunterPending.length}`,
          janitorRunning.length
            ? `janitor running: ${janitorRunning.map((j) => `${j.key} (${j.sessionId ?? 'starting'})`).join(', ')}`
            : 'janitor running: none',
          hunterRunning.length
            ? `hunter running: ${hunterRunning.map((j) => `${j.key} (${j.sessionId ?? 'starting'})`).join(', ')}`
            : 'hunter running: none',
        ].join('\n');
      };

      if (action === 'status') {
        await respond(`📋 **[Janitor Control]**\n\n${renderJobs()}`);
        handled();
      }

      if (!['stop', 'resume', 'clean', 'review'].includes(action)) {
        await respond(usage);
        handled();
      }

      const targetJanitor = target === 'all' || target === 'janitor';
      const targetHunter = target === 'all' || target === 'hunter';

      if (
        (action === 'stop' || action === 'resume') &&
        !['all', 'janitor', 'hunter'].includes(target)
      ) {
        await respond(usage);
        handled();
      }

      if (action === 'stop') {
        if (targetJanitor) control.pausedJanitor = true;
        if (targetHunter) control.pausedHunter = true;
        store.setPaused({
          janitor: control.pausedJanitor,
          hunter: control.pausedHunter,
        });

        let dropped = 0;
        let aborted = 0;
        if (targetJanitor) {
          dropped += orchestrator.clearPending();
          aborted += await orchestrator.abortRunning(ctx);
        }
        if (targetHunter) {
          dropped += hunterOrchestrator.clearPending();
          aborted += await hunterOrchestrator.abortRunning(ctx);
        }

        await respond(
          `🛑 **[Janitor Control]** stopped ${target}. dropped=${dropped}, aborted=${aborted}\n\n${renderJobs()}`,
        );
        handled();
      }

      if (action === 'resume') {
        if (targetJanitor) control.pausedJanitor = false;
        if (targetHunter) control.pausedHunter = false;
        store.setPaused({
          janitor: control.pausedJanitor,
          hunter: control.pausedHunter,
        });
        await respond(
          `▶️ **[Janitor Control]** resumed ${target}\n\n${renderJobs()}`,
        );
        handled();
      }

      if (action === 'clean') {
        const branch = (await exec('git rev-parse --abbrev-ref HEAD')).trim();
        const headSha = (await exec('git rev-parse HEAD')).trim();
        if (!branch || branch === 'HEAD' || !headSha) {
          await respond(
            '⚠️ **[Janitor Control]** clean requires a checked-out branch and a valid HEAD',
          );
          handled();
        }
        const workspace = await getWorkspaceCommitContext(config, exec);
        if (!workspace.patch.trim() && workspace.changedFiles.length === 0) {
          await respond(
            '🧼 **[Janitor Control]** clean: no workspace changes to review',
          );
          handled();
        }
        const runKey = workspaceKey(branch, headSha);
        orchestrator.enqueue(runKey, hookInput.sessionID);
        await respond(`🧼 **[Janitor Control]** clean queued: ${runKey}`);
        handled();
      }

      if (action === 'review') {
        let prContext: PrContext | null = null;
        const prArg = args[1];

        if (prArg) {
          if (!/^\d+$/.test(prArg)) {
            await respond(
              '⚠️ **[Janitor Control]** review expects optional numeric PR number, e.g. `/janitor review 123`',
            );
            handled();
          }
          const prNumber = Number(prArg);
          if (!(await isGhAvailable(exec))) {
            await respond(
              '⚠️ **[Janitor Control]** review PR requires gh CLI availability',
            );
            handled();
          }
          const ghPr = await getPrByNumberFromGh(exec, prNumber);
          if (!ghPr) {
            await respond(
              `⚠️ **[Janitor Control]** review: PR #${prNumber} not found or not open`,
            );
            handled();
          }
          const selectedPr = ghPr!;
          prContext = await getPrContext({
            baseRef: selectedPr.baseRef,
            headRef: selectedPr.headRef,
            headSha: selectedPr.headSha,
            number: selectedPr.number,
            config,
            exec,
          });
        } else {
          prContext = await getWorkspacePrContext(config, exec);
        }

        if (!prContext) {
          await respond(
            '⚠️ **[Janitor Control]** review requires a checked-out branch and valid repo state',
          );
          handled();
        }

        const reviewContext = prContext!;

        if (
          !reviewContext.patch.trim() &&
          reviewContext.changedFiles.length === 0
        ) {
          await respond(
            '🔍 **[Janitor Control]** review: no changes to review',
          );
          handled();
        }

        if (hasHunterHeadInFlight(reviewContext.headSha)) {
          await respond(
            `🔍 **[Janitor Control]** review skipped: in-flight ${reviewContext.headSha.slice(0, 8)}`,
          );
          handled();
        }

        hunterOrchestrator.enqueue(reviewContext, hookInput.sessionID);
        await respond(
          `🔍 **[Janitor Control]** review queued: ${reviewContext.key}`,
        );
        handled();
      }

      await respond(usage);
      handled();
    },

    'tool.execute.after': async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      if (runtime.disposed) return;
      if (input.tool !== 'Bash' && input.tool !== 'bash') return;

      const text = output.title || output.output || '';

      if (anyCommitReviews && /git\s+commit/.test(text)) {
        detector.accelerate();
      }

      if (!prDetector || !config.pr.detectToolHook) return;

      if (/git\s+push/.test(text)) {
        if (!ghAvailableAtStartup) {
          branchPushPending = true;
        }
        prDetector.accelerate();
        return;
      }

      if (/gh\s+pr\s+(create|ready|reopen|edit|merge)/.test(text)) {
        prDetector.accelerate();
      }
    },

    // Review completion detection + event logging
    event: async (input: {
      event: {
        type: string;
        properties?: Record<string, unknown>;
      };
    }) => {
      if (runtime.disposed) return;
      const { event } = input;

      // Stream events for tracked sessions to JSONL
      const eventSessionId = (event.properties?.sessionID ??
        (event.properties?.part as { sessionID?: string })?.sessionID) as
        | string
        | undefined;
      if (eventSessionId && trackedSessions.has(eventSessionId)) {
        try {
          appendEvent(stateDir, eventSessionId, event);
        } catch (err) {
          warn('[session-event] failed to append event', {
            error: String(err),
          });
        }
      }

      // Detect review session completion
      if (event.type === 'session.status') {
        const props = event.properties as
          | { status?: { type?: string }; sessionID?: string }
          | undefined;
        if (props?.status?.type === 'idle' && props?.sessionID) {
          // Update session metadata to reflect completion
          if (trackedSessions.has(props.sessionID)) {
            try {
              const metaPath = join(stateDir, `${props.sessionID}.json`);
              const existing = JSON.parse(readFileSync(metaPath, 'utf-8'));
              existing.status = 'completed';
              existing.completedAt = Date.now();
              atomicWriteSync(metaPath, JSON.stringify(existing, null, 2));
            } catch (err) {
              warn('[session-event] failed to update failed session metadata', {
                error: String(err),
              });
            }
            trackedSessions.delete(props.sessionID);
          }

          await orchestrator.handleCompletion(props.sessionID, ctx, config);
          await hunterOrchestrator.handleCompletion(
            props.sessionID,
            ctx,
            config,
          );
        }
      }

      // Detect review session error
      if (event.type === 'session.error') {
        const props = event.properties as
          | { error?: { message?: string }; sessionID?: string }
          | undefined;
        if (props?.sessionID && trackedSessions.has(props.sessionID)) {
          try {
            const metaPath = join(stateDir, `${props.sessionID}.json`);
            const existing = JSON.parse(readFileSync(metaPath, 'utf-8'));
            existing.status = 'failed';
            existing.completedAt = Date.now();
            existing.error = props.error?.message ?? 'unknown error';
            atomicWriteSync(metaPath, JSON.stringify(existing, null, 2));
          } catch (err) {
            warn('[session-event] failed to update failed session metadata', {
              error: String(err),
            });
          }
          trackedSessions.delete(props.sessionID);
          orchestrator.handleFailure(
            props.sessionID,
            props.error?.message ?? 'unknown error',
          );
          hunterOrchestrator.handleFailure(
            props.sessionID,
            props.error?.message ?? 'unknown error',
          );
        }
      }
    },
  } as JanitorPluginReturn;
};

export default TheJanitor;
