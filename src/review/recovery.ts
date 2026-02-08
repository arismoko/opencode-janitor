/**
 * Crash recovery — resume interrupted review sessions after restart.
 *
 * Reads the active-runs journal, checks each session's status via the
 * OpenCode SDK, and either reattaches or resumes depending on state.
 *
 * Decision matrix:
 *   busy/retry  → reattach only (wait for idle event)
 *   idle + attempts < MAX → reattach + send resume prompt
 *   idle + attempts >= MAX → reattach only (log warning)
 *   missing/undefined → session gone, remove from journal
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import type { PrContext } from '../git/pr-context-resolver';
import type { ActiveRun, ReviewRunStore } from '../state/review-run-store';
import { withTimeout } from '../utils/async';
import { log, warn } from '../utils/logger';
import type { BaseOrchestrator } from './base-orchestrator';
import { resumeReviewSession } from './runner';

const RUN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESUME_ATTEMPTS = 1;
const STATUS_TIMEOUT_MS = 3_000;
const RESUME_TIMEOUT_MS = 5_000;

/**
 * Reconstruct a minimal PrContext from a persisted key string.
 * Used during recovery when the full PrContext is no longer available.
 * The orchestrator only needs the key for dedup tracking — the review
 * session already has full context from its original prompt.
 */
export function buildRecoveredPrContext(key: string): PrContext {
  if (key.startsWith('pr:')) {
    const [, numStr, headSha] = key.split(':');
    const number = Number(numStr);
    return {
      key,
      headSha: headSha ?? '',
      baseRef: '',
      headRef: '',
      number: Number.isFinite(number) ? number : undefined,
      changedFiles: [],
      patch: '',
      patchTruncated: false,
    };
  }

  if (key.startsWith('branch:')) {
    const prefix = 'branch:';
    const tail = key.slice(prefix.length);
    const splitAt = tail.lastIndexOf(':');
    const headRef = splitAt > 0 ? tail.slice(0, splitAt) : '';
    const headSha = splitAt > 0 ? tail.slice(splitAt + 1) : '';
    return {
      key,
      headSha,
      baseRef: '',
      headRef,
      changedFiles: [],
      patch: '',
      patchTruncated: false,
    };
  }

  return {
    key,
    headSha: '',
    baseRef: '',
    headRef: '',
    changedFiles: [],
    patch: '',
    patchTruncated: false,
  };
}

/** Minimal orchestrator interface for run tracking — avoids generic variance issues. */
interface RunTrackable {
  onRunStarted(
    cb: (info: {
      key: string;
      sessionId: string;
      parentSessionId: string;
    }) => void,
  ): void;
  onRunTerminal(cb: (key: string) => void): void;
}

/**
 * Wire onRunStarted/onRunTerminal callbacks to the run store for a
 * given orchestrator. Eliminates repeated boilerplate in index.ts.
 */
export function bindRunTracking(
  orchestrator: RunTrackable,
  type: 'janitor' | 'reviewer',
  runStore: ReviewRunStore,
): void {
  orchestrator.onRunStarted(({ key, sessionId, parentSessionId }) => {
    runStore.track({
      id: `${type}:${key}`,
      orchestrator: type,
      key,
      sessionId,
      parentSessionId,
      startedAt: new Date().toISOString(),
    });
  });

  orchestrator.onRunTerminal((key) => {
    runStore.complete(`${type}:${key}`);
  });
}

interface RecoveryDeps {
  ctx: PluginInput;
  config: JanitorConfig;
  runStore: ReviewRunStore;
  janitorOrchestrator: BaseOrchestrator<string, unknown>;
  reviewerOrchestrator: BaseOrchestrator<PrContext, unknown>;
}

/**
 * Recover interrupted review runs from the active-runs journal.
 *
 * Must be called BEFORE detectors start so recovered runs don't
 * collide with freshly detected signals.
 */
export async function recoverInterruptedRuns(
  deps: RecoveryDeps,
): Promise<void> {
  const { ctx, config, runStore, janitorOrchestrator, reviewerOrchestrator } =
    deps;

  runStore.pruneStale(RUN_TTL_MS);

  const activeRuns = runStore.getActive();
  if (activeRuns.length === 0) return;

  let statusMap: Record<string, { type?: string }> = {};
  try {
    const statusResult = await withTimeout(
      ctx.client.session.status(),
      STATUS_TIMEOUT_MS,
      'session.status',
    );
    statusMap = (statusResult.data ?? {}) as Record<string, { type?: string }>;
  } catch (err) {
    warn(`[recovery] failed to load session statuses: ${err}`);
    return;
  }

  for (const run of activeRuns) {
    const type = statusMap[run.sessionId]?.type;

    // Session gone — clean up journal entry
    if (type === undefined) {
      runStore.complete(run.id);
      continue;
    }

    // Completed/idle sessions that aren't busy/retry are already delivered
    // (user preference: ignore on restart). But idle sessions may also be
    // interrupted mid-generation — we handle that below.
    const isActive = type === 'busy' || type === 'retry';
    const isIdle = type === 'idle';

    if (!isActive && !isIdle) {
      // Unknown status — clean up
      runStore.complete(run.id);
      continue;
    }

    // Always reattach regardless of resume attempt count.
    // This ensures idle events are captured even if we've exhausted
    // resume prompts.
    const attached = reattachRun(
      run,
      janitorOrchestrator,
      reviewerOrchestrator,
    );

    if (!attached) {
      runStore.complete(run.id);
      continue;
    }

    // For busy/retry sessions: just wait for the existing generation to
    // complete. Sending a second prompt would corrupt the output.
    if (isActive) {
      log(`[recovery] reattached active session ${run.id} (status=${type})`);
      continue;
    }

    // For idle sessions: the session was interrupted and is now idle.
    // Only send a resume prompt if we haven't exhausted attempts.
    if (run.resumeAttempts >= MAX_RESUME_ATTEMPTS) {
      warn(
        `[recovery] ${run.id} idle but resume attempts exhausted — reattached without resume`,
      );
      continue;
    }

    // Send resume prompt. On failure, keep the run attached — it may
    // complete via normal idle events or be retried on next restart.
    try {
      await withTimeout(
        resumeReviewSession(ctx, {
          sessionId: run.sessionId,
          agent: run.orchestrator === 'janitor' ? 'janitor' : 'code-reviewer',
          modelId:
            run.orchestrator === 'janitor'
              ? (config.agents.janitor.modelId ?? config.model.id)
              : (config.agents.reviewer.modelId ?? config.model.id),
        }),
        RESUME_TIMEOUT_MS,
        `resume ${run.id}`,
      );
      runStore.incrementResumeAttempts(run.id);
      log(`[recovery] resumed idle session ${run.id}`);
    } catch (err) {
      // P1 FIX: Do NOT discard on resume failure. The session may still
      // be running (transient network error on promptAsync). Keep it
      // attached so idle events can still be matched.
      warn(`[recovery] failed to resume ${run.id}: ${err} — keeping attached`);
      runStore.incrementResumeAttempts(run.id);
    }
  }
}

/**
 * Reattach a persisted run to its orchestrator's tracking maps.
 */
function reattachRun(
  run: ActiveRun,
  janitorOrchestrator: BaseOrchestrator<string, unknown>,
  reviewerOrchestrator: BaseOrchestrator<PrContext, unknown>,
): boolean {
  if (run.orchestrator === 'janitor') {
    return janitorOrchestrator.registerRecoveredRun(
      run.key,
      run.parentSessionId,
      run.sessionId,
    );
  }
  return reviewerOrchestrator.registerRecoveredRun(
    buildRecoveredPrContext(run.key),
    run.parentSessionId,
    run.sessionId,
  );
}
