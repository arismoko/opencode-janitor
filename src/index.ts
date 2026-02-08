/**
 * The Janitor — OpenCode plugin entry point.
 *
 * Wires commit detection → review orchestration → result delivery.
 */

import type { Plugin } from '@opencode-ai/plugin';
import { loadConfig } from './config/loader';
import { CommitDetector } from './git/commit-detector';
import { getCommitContext } from './git/commit-resolver';
import {
  getCurrentPrFromGh,
  isGhAvailable,
  postPrReviewWithGh,
} from './git/gh-pr';
import { getPrContext, type PrContext } from './git/pr-context-resolver';
import { PrDetector } from './git/pr-detector';
import { resolveGitDir } from './git/repo-locator';
import { RetryableSignalError } from './git/signal-detector';
import { HistoryStore } from './history/store';
import { createJanitorAgent } from './review/janitor-agent';
import { ReviewOrchestrator } from './review/orchestrator';
import { buildReviewPrompt } from './review/prompt-builder';
import { bindRunTracking, recoverInterruptedRuns } from './review/recovery';
import { createReviewerAgent } from './review/reviewer-agent';
import { ReviewerOrchestrator } from './review/reviewer-orchestrator';
import { buildReviewerPrompt } from './review/reviewer-prompt-builder';
import { spawnJanitorReview, spawnReviewerReview } from './review/runner';
import { ReviewRunStore } from './state/review-run-store';
import { CommitStore } from './state/store';
import { buildSuppressionsBlock } from './suppressions/prompt';
import { SuppressionStore } from './suppressions/store';
import { log, warn } from './utils/logger';

/** Plugin return shape — typed locally since the SDK Plugin type doesn't
 *  export a precise return interface for hooks we use. */
interface JanitorPluginReturn {
  name: string;
  config?: (config: Record<string, unknown>) => Promise<void>;
  cleanup?: () => void;
  'tool.execute.after'?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ) => Promise<void>;
  event?: (input: {
    event: { type: string; properties?: Record<string, unknown> };
  }) => Promise<void>;
}

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

type TriggerMode = 'commit' | 'pr' | 'both';

function triggerMatches(trigger: TriggerMode, mode: 'commit' | 'pr'): boolean {
  return trigger === mode || trigger === 'both';
}

const TheJanitor: Plugin = async (ctx) => {
  const config = loadConfig(ctx.directory);
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
  const reviewerAgent = createReviewerAgent(config);

  const janitorCommitEnabled =
    config.agents.janitor.enabled &&
    triggerMatches(config.agents.janitor.trigger, 'commit');
  const janitorPrEnabled =
    config.agents.janitor.enabled &&
    triggerMatches(config.agents.janitor.trigger, 'pr');
  const reviewerCommitEnabled =
    config.agents.reviewer.enabled &&
    triggerMatches(config.agents.reviewer.trigger, 'commit');
  const reviewerPrEnabled =
    config.agents.reviewer.enabled &&
    triggerMatches(config.agents.reviewer.trigger, 'pr');

  const anyCommitReviews = janitorCommitEnabled || reviewerCommitEnabled;
  const anyPrReviews = janitorPrEnabled || reviewerPrEnabled;

  const ghAvailableAtStartup = anyPrReviews ? await isGhAvailable(exec) : false;
  if (anyPrReviews && !ghAvailableAtStartup) {
    warn(
      '[init] gh CLI not available — PR reviews will fall back to session/toast/file delivery',
    );
  }

  const store = new CommitStore(ctx.directory);
  const runStore = new ReviewRunStore(ctx.directory);
  const suppressionStore = new SuppressionStore(ctx.directory, {
    maxEntries: config.suppressions?.maxEntries,
  });
  const historyStore = new HistoryStore(ctx.directory, {
    maxReviews: config.history?.maxReviews,
    maxBytes: config.history?.maxBytes,
  });

  // Seed detector with previously processed SHAs
  const previouslyProcessed = store.getProcessed();

  // Orchestrator handles queuing and review lifecycle
  const orchestrator = new ReviewOrchestrator(
    config,
    async (sha, parentSessionId) => {
      const commit = await getCommitContext(sha, config, exec);

      // Hollow review guard: reject commits with no meaningful diff content.
      // This prevents wasted review cycles and misleading "all clean" results
      // when git commands failed silently or the commit is truly empty.
      if (!commit.patch.trim() && commit.changedFiles.length === 0) {
        throw new Error(
          `Empty commit context for ${sha.slice(0, 8)} — no patch or changed files`,
        );
      }

      const suppressionsBlock = config.suppressions?.enabled
        ? buildSuppressionsBlock(
            suppressionStore.getActive(),
            config.suppressions?.maxPromptBytes,
          )
        : '';
      const prompt = buildReviewPrompt(commit, {
        categories: Object.entries(config.categories)
          .filter(([, v]) => v)
          .map(([k]) => k),
        maxFindings: config.model.maxFindings,
        scopeInclude: config.scope.include,
        scopeExclude: config.scope.exclude,
        suppressionsBlock,
      });

      const sessionId = await spawnJanitorReview(ctx, {
        parentSessionId,
        prompt,
        config,
      });
      return sessionId;
    },
    suppressionStore,
    historyStore,
  );

  // Persist SHA only after review completes successfully
  orchestrator.onCompleted((sha) => {
    store.add(sha);
    log(`persisted reviewed commit: ${sha}`);
  });

  bindRunTracking(orchestrator, 'janitor', runStore);

  // Give orchestrator access to the SDK client for error injection
  orchestrator.setContext(ctx);

  const reviewerOrchestrator = new ReviewerOrchestrator(
    config,
    async (prContext, parentSessionId) => {
      const prompt = buildReviewerPrompt(prContext, {
        scopeInclude: config.scope.include,
        scopeExclude: config.scope.exclude,
      });

      const sessionId = await spawnReviewerReview(ctx, {
        parentSessionId,
        prompt,
        config,
      });
      return sessionId;
    },
    async (prNumber, body) => {
      if (!(await isGhAvailable(exec))) return false;
      return postPrReviewWithGh(exec, prNumber, body);
    },
  );
  reviewerOrchestrator.setContext(ctx);

  bindRunTracking(reviewerOrchestrator, 'reviewer', runStore);

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
      log(`new commit detected: ${sha} via ${signal.source}`);

      if (janitorCommitEnabled) {
        orchestrator.enqueue(sha);
      }

      if (reviewerCommitEnabled) {
        const commit = await getCommitContext(sha, config, exec);

        if (!commit.patch.trim() && commit.changedFiles.length === 0) {
          warn(`[reviewer] skipping empty commit context: ${sha.slice(0, 8)}`);
        } else {
          reviewerOrchestrator.enqueue({
            key: `commit:${sha}`,
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
            return `pr:${ghPr.number}:${ghPr.headSha}`;
          }

          // No gh available — only react after an observed push command.
          if (!branchPushPending) return null;

          const branch = (await exec('git rev-parse --abbrev-ref HEAD')).trim();
          if (!branch || branch === 'HEAD') return null;

          const headSha = (await exec('git rev-parse HEAD')).trim();
          if (!headSha) return null;

          return `branch:${branch}:${headSha}`;
        },
        async (key, signal) => {
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
              // Throw retryable so verify does NOT mark this key as
              // processed — next poll's getCurrentKey returns null and
              // skips naturally.
              throw new RetryableSignalError(
                `PR disappeared between detection and callback: ${key}`,
              );
            }

            if (ghPr.number !== detectedPrNum || ghPr.headSha !== detectedSha) {
              // PR state advanced between detection and re-fetch.
              // Throw retryable so verify doesn't commit the stale key —
              // the new state will be picked up on the next poll cycle.
              throw new RetryableSignalError(
                `PR state changed between detection and callback: key=${key} but re-fetch got pr:${ghPr.number}:${ghPr.headSha}`,
              );
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

          if (janitorPrEnabled) {
            orchestrator.enqueue(prContext.headSha);
          }

          if (reviewerPrEnabled) {
            reviewerOrchestrator.enqueue(prContext);
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

  await recoverInterruptedRuns({
    ctx,
    config,
    runStore,
    janitorOrchestrator: orchestrator,
    reviewerOrchestrator,
  });

  if (anyCommitReviews) {
    await detector.start(gitDir);
  }

  if (prDetector) {
    prDetector.start();
  }

  toast(ctx, 'Janitor: watchers active');
  log(`initialized — watching ${gitDir}`);

  return {
    name: 'the-janitor',

    // Register janitor + reviewer agents in OpenCode's agent registry.
    // Plugins must mutate the config object in place — the return value
    // of the config hook is ignored.
    config: async (opencodeConfig: Record<string, unknown>) => {
      const agents = (opencodeConfig.agent ?? {}) as Record<string, unknown>;

      for (const agent of [janitorAgent, reviewerAgent]) {
        agents[agent.name] = {
          ...agent.config,
          description: agent.description,
        };
      }

      opencodeConfig.agent = agents;
      log("registered agents 'janitor' and 'code-reviewer' in config hook");
    },

    cleanup: () => {
      detector.stop();
      prDetector?.stop();
      log('plugin cleanup: detectors stopped');
    },

    // Also bootstraps session tracking: after a restart the plugin may
    // miss the initial session.created event, so we capture the sessionID
    // from the first tool call we see.
    'tool.execute.after': async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      // Bootstrap session tracking from any tool call — covers the case
      // where the plugin loads into an already-existing session and never
      // receives a session.created event.
      if (input.sessionID) {
        const janitorOwnsSession = orchestrator.isOwnSession(input.sessionID);
        const reviewerOwnsSession = reviewerOrchestrator.isOwnSession(
          input.sessionID,
        );

        // Never promote child review sessions as roots.
        if (!janitorOwnsSession && !reviewerOwnsSession) {
          // Bootstrap only when root tracking is missing; normal root rotation
          // is handled by session.created events.
          if (!orchestrator.hasRootSession()) {
            orchestrator.sessionAvailable(input.sessionID);
          }
          if (!reviewerOrchestrator.hasRootSession()) {
            reviewerOrchestrator.sessionAvailable(input.sessionID);
          }
        }
      }

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

    // Session tracking + review completion detection
    event: async (input: {
      event: {
        type: string;
        properties?: Record<string, unknown>;
      };
    }) => {
      const { event } = input;

      // Track current root session
      if (event.type === 'session.created') {
        const info = event.properties?.info as
          | { id?: string; parentID?: string }
          | undefined;
        if (info?.id && !info?.parentID) {
          log(`tracking root session: ${info.id}`);
          orchestrator.sessionAvailable(info.id);
          reviewerOrchestrator.sessionAvailable(info.id);
        }
      }

      // Detect review session completion
      if (event.type === 'session.status') {
        const props = event.properties as
          | { status?: { type?: string }; sessionID?: string }
          | undefined;
        if (props?.status?.type === 'idle' && props?.sessionID) {
          await orchestrator.handleCompletion(props.sessionID, ctx, config);
          await reviewerOrchestrator.handleCompletion(
            props.sessionID,
            ctx,
            config,
          );
        }
      }
    },
  } as JanitorPluginReturn;
};

export default TheJanitor;
