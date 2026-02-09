/**
 * Detector runtime — commit and PR signal detection.
 */

import { CommitDetector } from '../git/commit-detector';
import { getCommitContext } from '../git/commit-resolver';
import { getCurrentPrFromGh } from '../git/gh-pr';
import { getPrContext, type PrContext } from '../git/pr-context-resolver';
import { PrDetector } from '../git/pr-detector';
import { log, warn } from '../utils/logger';
import { branchKey, commitKey, prKey } from '../utils/review-key';
import type { AgentQueues } from './agent-runtime';
import type { BootstrapServices } from './bootstrap';
import type { RuntimeContext } from './context';

export interface Detectors {
  detector: CommitDetector;
  prDetector: PrDetector | null;
}

/**
 * Create commit and PR detectors.
 *
 * The `rcRef` getter is called lazily from closures after rcRef is assigned
 * in the composition root, so branchPushPending mutations from tool hooks
 * are visible.
 */
export function createDetectors(
  svc: BootstrapServices,
  queues: AgentQueues,
  getRcRef: () => RuntimeContext,
): Detectors {
  const {
    ctx,
    config,
    exec,
    store,
    control,
    runtime,
    ghAvailableAtStartup,
    agentTriggers,
    anyPrReviews,
  } = svc;

  const { janitorQueue, hunterQueue, inspectorQueue, scribeQueue } = queues;

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

      // Resolve commit context once for both agents
      const commit = await getCommitContext(sha, config, exec);

      if (commit.deletionOnly) {
        log(`[detector] skipping deletion-only commit: ${sha.slice(0, 8)}`);
        return;
      }

      if (agentTriggers.janitor.commit) {
        if (!control.pausedJanitor) {
          if (runtime.disposed) return;
          janitorQueue.enqueue(sha);
        }
      }

      if (agentTriggers.hunter.commit) {
        if (control.pausedHunter) {
          return;
        }
        if (runtime.disposed) return;
        if (hunterQueue.hasHeadInFlight(sha)) {
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

        if (!commit.patch.trim() && commit.changedFiles.length === 0) {
          warn(`[hunter] skipping empty commit context: ${sha.slice(0, 8)}`);
        } else {
          hunterQueue.enqueue({
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

      if (agentTriggers.inspector.commit) {
        if (!control.pausedInspector) {
          if (runtime.disposed) return;
          inspectorQueue.enqueue(`inspector:auto:commit:${sha}`);
        }
      }

      if (agentTriggers.scribe.commit) {
        if (!control.pausedScribe) {
          if (runtime.disposed) return;
          scribeQueue.enqueue(`scribe:auto:commit:${sha}`);
        }
      }
    },
    config.autoReview.debounceMs,
    config.autoReview.pollFallbackSec,
  );

  // PR detector
  const prDetector = anyPrReviews
    ? new PrDetector(
        async () => {
          if (ghAvailableAtStartup) {
            const ghPr = await getCurrentPrFromGh(exec);
            if (!ghPr) return null;
            return prKey(ghPr.number, ghPr.headSha);
          }

          if (!getRcRef().branchPushPending) return null;

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

            getRcRef().branchPushPending = false;
          }

          if (!prContext.patch.trim() && prContext.changedFiles.length === 0) {
            warn(`[pr] skipping empty PR context: ${prContext.key}`);
            return;
          }

          if (!store.hasProcessedPrKey(prContext.key)) {
            store.addPrKey(prContext.key);
          }

          if (agentTriggers.janitor.pr) {
            if (!control.pausedJanitor) {
              if (runtime.disposed) return;
              if (
                agentTriggers.janitor.commit &&
                store.hasProcessedSha(prContext.headSha)
              ) {
                log(
                  `[janitor] skipping PR-triggered duplicate for processed SHA: ${prContext.headSha.slice(0, 8)}`,
                );
              } else {
                janitorQueue.enqueue(prContext.headSha);
              }
            }
          }

          if (agentTriggers.hunter.pr) {
            if (!control.pausedHunter) {
              if (runtime.disposed) return;
              if (hunterQueue.hasHeadInFlight(prContext.headSha)) {
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
              hunterQueue.enqueue(prContext);
            }
          }

          if (agentTriggers.inspector.pr) {
            if (!control.pausedInspector) {
              if (runtime.disposed) return;
              inspectorQueue.enqueue(`inspector:auto:pr:${prContext.key}`);
            }
          }

          if (agentTriggers.scribe.pr) {
            if (!control.pausedScribe) {
              if (runtime.disposed) return;
              scribeQueue.enqueue(`scribe:auto:pr:${prContext.key}`);
            }
          }
        },
        config.autoReview.debounceMs,
        config.pr.pollSec,
      )
    : null;

  return { detector, prDetector };
}
