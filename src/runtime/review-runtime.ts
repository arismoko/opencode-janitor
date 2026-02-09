/**
 * Review runtime — bootstraps detectors, queues, and services.
 *
 * Creates the full RuntimeContext that hooks consume. Handles:
 * - Config loading and exec bridge creation
 * - Git directory resolution
 * - Agent creation
 * - Queue setup (janitor orchestrator + hunter orchestrator)
 * - Commit/PR detector setup and seeding
 * - Runtime lifecycle (start/stop)
 */

import { join } from 'node:path';
import type { PluginInput } from '@opencode-ai/plugin';
import { loadConfig } from '../config/loader';
import { CommitDetector } from '../git/commit-detector';
import {
  getCommitContext,
  getWorkspaceCommitContext,
} from '../git/commit-resolver';
import {
  getCurrentPrFromGh,
  isGhAvailable,
  postPrReviewWithGh,
} from '../git/gh-pr';
import { getPrContext, type PrContext } from '../git/pr-context-resolver';
import { PrDetector } from '../git/pr-detector';
import { resolveGitDir } from '../git/repo-locator';
import { HistoryStore } from '../history/store';
import { buildReviewPrompt } from '../review/prompt-builder';
import { ReviewRunQueue } from '../review/review-run-queue';
import { spawnReview } from '../review/runner';
import { HunterStrategy } from '../review/strategies/hunter-strategy';
import { JanitorStrategy } from '../review/strategies/janitor-strategy';
import { RuntimeStateStore } from '../state/store';
import { buildSuppressionsBlock } from '../suppressions/prompt';
import { SuppressionStore } from '../suppressions/store';
import type { HunterResult, ReviewResult } from '../types';
import { atomicWriteSync } from '../utils/atomic-write';
import { log, warn } from '../utils/logger';
import {
  branchKey,
  commitKey,
  extractHeadSha,
  prKey,
} from '../utils/review-key';
import { ensureStateDir, resolveStateDir } from '../utils/state-dir';
import { createExec, type RuntimeContext } from './context';

type TriggerMode = 'commit' | 'pr' | 'both' | 'never';

function triggerMatches(trigger: TriggerMode, mode: 'commit' | 'pr'): boolean {
  if (trigger === 'never') return false;
  return trigger === mode || trigger === 'both';
}

export interface BootstrapResult {
  rc: RuntimeContext;
  stop: () => Promise<void>;
}

/**
 * Bootstrap the review runtime.
 *
 * Returns the fully populated RuntimeContext and a stop function for teardown.
 * Returns null if the plugin should be inactive (no git repo or disabled).
 */
export async function bootstrapRuntime(
  ctx: PluginInput,
): Promise<BootstrapResult | null> {
  const config = loadConfig(ctx.directory);

  if (!config.enabled) {
    log('disabled by config');
    return null;
  }

  const exec = createExec(ctx);

  let gitDir: string;
  try {
    gitDir = await resolveGitDir(ctx.directory, exec);
  } catch {
    warn(`no git repo at ${ctx.directory} — janitor inactive`);
    return null;
  }

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

  const stateDir = resolveStateDir(ctx.directory);
  ensureStateDir(stateDir);
  const trackedSessions = new Set<string>();

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

  const previouslyProcessed = store.getProcessed();
  const previouslyProcessedPrKeys = store.getProcessedPrKeys();

  // Forward-declare rcRef so closures created below can reference it.
  // By the time any closure executes (after start()), rcRef is assigned.
  let rcRef: RuntimeContext;

  // Janitor orchestrator
  const janitorStrategy = new JanitorStrategy(suppressionStore, historyStore);
  const orchestrator = new ReviewRunQueue<string, ReviewResult>(
    config,
    async (runKey) => {
      const workspace = runKey.startsWith('workspace:');
      const commit = workspace
        ? await getWorkspaceCommitContext(config, exec)
        : await getCommitContext(runKey, config, exec);

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

  orchestrator.onCompleted((sha) => {
    if (sha.startsWith('workspace:')) return;
    store.add(sha);
    log(`persisted reviewed commit: ${sha}`);
  });
  orchestrator.setContext(ctx);

  // Hunter orchestrator
  const hunterStrategy = new HunterStrategy(
    async (prNumber: number, body: string) => {
      if (!(await isGhAvailable(exec))) return false;
      return postPrReviewWithGh(exec, prNumber, body);
    },
  );
  const hunterOrchestrator = new ReviewRunQueue<PrContext, HunterResult>(
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

  // PR detector — closures reference rcRef.branchPushPending so mutations
  // from tool hooks (which set rc.branchPushPending = true) are visible here.
  const prDetector = anyPrReviews
    ? new PrDetector(
        async () => {
          if (ghAvailableAtStartup) {
            const ghPr = await getCurrentPrFromGh(exec);
            if (!ghPr) return null;
            return prKey(ghPr.number, ghPr.headSha);
          }

          if (!rcRef.branchPushPending) return null;

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
            const [, prNumStr, detectedSha] = key.split(':');
            const detectedPrNum = Number(prNumStr);

            const ghPr = await getCurrentPrFromGh(exec);
            if (!ghPr) {
              warn(`PR disappeared between detection and callback: ${key}`);
              return;
            }

            if (ghPr.number !== detectedPrNum || ghPr.headSha !== detectedSha) {
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

            rcRef.branchPushPending = false;
          }

          if (!prContext.patch.trim() && prContext.changedFiles.length === 0) {
            warn(`[pr] skipping empty PR context: ${prContext.key}`);
            return;
          }

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

  // Pre-seed processed SHAs
  if (janitorCommitEnabled) {
    for (const sha of previouslyProcessed) {
      detector.markProcessed(sha);
    }
  }

  if (anyCommitReviews) {
    await detector.start(gitDir);
  }

  // Build RuntimeContext — must be assigned before starting prDetector
  // because prDetector closures reference rcRef.branchPushPending.
  rcRef = {
    ctx,
    config,
    exec,
    gitDir,
    stateDir,
    store,
    suppressionStore,
    historyStore,
    orchestrator,
    hunterOrchestrator,
    detector,
    prDetector,
    trackedSessions,
    control,
    runtime,
    ghAvailableAtStartup,
    branchPushPending: false,
    janitorCommitEnabled,
    janitorPrEnabled,
    hunterCommitEnabled,
    hunterPrEnabled,
    anyCommitReviews,
    anyPrReviews,
    writeSessionMeta,
  };

  if (prDetector) {
    for (const key of previouslyProcessedPrKeys) {
      prDetector.markProcessed(key);
    }
    prDetector.start();
  }

  const stop = async () => {
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

  log(`initialized — watching ${gitDir}`);

  return { rc: rcRef, stop };
}
