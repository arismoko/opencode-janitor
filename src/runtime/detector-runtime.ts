/**
 * Detector runtime — commit and PR signal detection.
 */

import { CommitDetector } from '../git/commit-detector';
import { getCommitContext } from '../git/commit-resolver';
import { getCurrentPrFromGh } from '../git/gh-pr';
import { getPrContext, type PrContext } from '../git/pr-context-resolver';
import { PrDetector } from '../git/pr-detector';
import { log, warn } from '../utils/logger';
import {
  branchKey,
  commitKey,
  parseReviewKey,
  prKey,
} from '../utils/review-key';
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

      // ── Resolve context ──────────────────────────────────────────────
      const commit = await getCommitContext(sha, config, exec);
      if (commit.deletionOnly) {
        log(`[detector] skipping deletion-only commit: ${sha.slice(0, 8)}`);
        return;
      }

      // ── Janitor ──────────────────────────────────────────────────────
      if (agentTriggers.janitor.commit && !control.paused.janitor) {
        if (runtime.disposed) return;
        janitorQueue.enqueue(sha);
      }

      // ── Hunter (commit-as-PR context) ────────────────────────────────
      if (agentTriggers.hunter.commit && !control.paused.hunter) {
        if (runtime.disposed) return;
        if (hunterQueue.hasHeadInFlight(sha)) {
          log(
            `[hunter] skipping commit-triggered in-flight duplicate: ${sha.slice(0, 8)}`,
          );
        } else if (store.hasProcessedHunterHead(sha)) {
          log(
            `[hunter] skipping commit-triggered duplicate for processed head: ${sha.slice(0, 8)}`,
          );
        } else if (!commit.patch.trim() && commit.changedFiles.length === 0) {
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

      // ── Inspector ────────────────────────────────────────────────────
      if (agentTriggers.inspector.commit && !control.paused.inspector) {
        if (runtime.disposed) return;
        inspectorQueue.enqueue(`inspector:auto:commit:${sha}`);
      }

      // ── Scribe ───────────────────────────────────────────────────────
      if (agentTriggers.scribe.commit && !control.paused.scribe) {
        if (runtime.disposed) return;
        scribeQueue.enqueue(`scribe:auto:commit:${sha}`);
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

          // ── Resolve PR context ─────────────────────────────────────────
          let prContext: PrContext;
          const parsed = parseReviewKey(key);

          if (parsed?.type === 'pr') {
            const { number: detectedPrNum, headSha: detectedSha } = parsed;

            const ghPr = await getCurrentPrFromGh(exec);
            if (!ghPr) {
              throw new Error(
                `PR disappeared between detection and callback: ${key}`,
              );
            }
            if (ghPr.number !== detectedPrNum || ghPr.headSha !== detectedSha) {
              throw new Error(
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

            getRcRef().branchPushPending = false;
          }

          // ── Guard: empty context ───────────────────────────────────────
          if (!prContext.patch.trim() && prContext.changedFiles.length === 0) {
            warn(`[pr] skipping empty PR context: ${prContext.key}`);
            return;
          }

          // ── Janitor (SHA dedup against commit trigger) ─────────────────
          if (agentTriggers.janitor.pr && !control.paused.janitor) {
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

          // ── Hunter (head-in-flight + processed-head dedup) ─────────────
          if (agentTriggers.hunter.pr && !control.paused.hunter) {
            if (runtime.disposed) return;
            if (hunterQueue.hasHeadInFlight(prContext.headSha)) {
              log(
                `[hunter] skipping PR-triggered in-flight duplicate: ${prContext.headSha.slice(0, 8)}`,
              );
            } else if (store.hasProcessedHunterHead(prContext.headSha)) {
              log(
                `[hunter] skipping PR-triggered duplicate for processed head: ${prContext.headSha.slice(0, 8)}`,
              );
            } else {
              hunterQueue.enqueue(prContext);
            }
          }

          // ── Inspector ──────────────────────────────────────────────────
          if (agentTriggers.inspector.pr && !control.paused.inspector) {
            if (runtime.disposed) return;
            inspectorQueue.enqueue(`inspector:auto:pr:${prContext.key}`);
          }

          // ── Scribe ─────────────────────────────────────────────────────
          if (agentTriggers.scribe.pr && !control.paused.scribe) {
            if (runtime.disposed) return;
            scribeQueue.enqueue(`scribe:auto:pr:${prContext.key}`);
          }
        },
        config.autoReview.debounceMs,
        config.pr.pollSec,
      )
    : null;

  return { detector, prDetector };
}
