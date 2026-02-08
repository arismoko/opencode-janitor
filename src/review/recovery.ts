/**
 * Crash recovery — resume interrupted review sessions after restart.
 *
 * Reads the active-runs journal, checks each session's status via the
 * OpenCode SDK, and either finalizes or resumes depending on state.
 *
 * Decision matrix:
 *   busy/retry  → reattach only (wait for idle event)
 *   idle + has output → reattach + immediately finalize via handleCompletion
 *   idle + no output + attempts < MAX → reattach + send resume prompt
 *   idle + no output + attempts >= MAX → reattach + finalize (best-effort)
 *   missing/undefined → session gone, remove from journal
 *   status fetch failed → conservatively reattach all runs
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
const MESSAGES_TIMEOUT_MS = 3_000;

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

  // Try to load session statuses. On failure, conservatively reattach all
  // runs so sessionToKey mappings are restored — idle events arriving later
  // will still be matched and processed.
  let statusMap: Record<string, { type?: string }> | null = null;
  try {
    const statusResult = await withTimeout(
      ctx.client.session.status(),
      STATUS_TIMEOUT_MS,
      'session.status',
    );
    statusMap = (statusResult.data ?? {}) as Record<string, { type?: string }>;
  } catch (err) {
    warn(
      `[recovery] failed to load session statuses: ${err} — reattaching all runs conservatively`,
    );
  }

  for (const run of activeRuns) {
    // When status fetch failed, we don't know session state. Conservatively
    // reattach so handleCompletion can match idle events that arrive later.
    if (statusMap === null) {
      const attached = reattachRun(
        run,
        janitorOrchestrator,
        reviewerOrchestrator,
      );
      if (!attached) {
        runStore.complete(run.id);
      } else {
        log(`[recovery] conservatively reattached ${run.id} (status unknown)`);
      }
      continue;
    }

    const type = statusMap[run.sessionId]?.type;

    // Session gone — clean up journal entry
    if (type === undefined) {
      runStore.complete(run.id);
      continue;
    }

    const isActive = type === 'busy' || type === 'retry';
    const isIdle = type === 'idle';

    if (!isActive && !isIdle) {
      // Unknown status — clean up
      runStore.complete(run.id);
      continue;
    }

    // Always reattach first — this restores sessionToKey so idle events are matched.
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

    // For idle sessions: check if the session already has usable output.
    // If it does, finalize immediately via handleCompletion — avoids the
    // double-JSON corruption risk of blindly sending a resume prompt.
    const hasOutput = await sessionHasAssistantOutput(ctx, run.sessionId);

    if (hasOutput) {
      log(`[recovery] ${run.id} idle with existing output — finalizing`);
      await finalizeRecoveredRun(run, deps);
      continue;
    }

    // No usable output. If we haven't exhausted resume attempts, try
    // resuming so the model can produce findings.
    if (run.resumeAttempts >= MAX_RESUME_ATTEMPTS) {
      // Exhausted — finalize with whatever's there (likely empty/clean).
      warn(
        `[recovery] ${run.id} idle, no output, resume attempts exhausted — finalizing`,
      );
      await finalizeRecoveredRun(run, deps);
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
      log(`[recovery] resumed idle session ${run.id} (no prior output)`);
    } catch (err) {
      warn(`[recovery] failed to resume ${run.id}: ${err} — keeping attached`);
      runStore.incrementResumeAttempts(run.id);
    }
  }
}

/**
 * Check whether a session has any assistant text output.
 * Used to decide if an idle recovered session should be finalized
 * (has output) or resumed (no output yet).
 */
async function sessionHasAssistantOutput(
  ctx: PluginInput,
  sessionId: string,
): Promise<boolean> {
  try {
    const result = await withTimeout(
      ctx.client.session.messages({ path: { id: sessionId } }),
      MESSAGES_TIMEOUT_MS,
      `messages ${sessionId}`,
    );
    const messages = (result.data ?? []) as Array<{
      info?: { role: string };
      parts?: Array<{ type: string; text?: string }>;
    }>;

    for (const msg of messages) {
      if (msg.info?.role !== 'assistant') continue;
      for (const part of msg.parts ?? []) {
        if (part.type === 'text' && part.text?.trim()) {
          return true;
        }
      }
    }
    return false;
  } catch (err) {
    warn(`[recovery] failed to read messages for ${sessionId}: ${err}`);
    // Can't determine — assume no output, let resume or finalize handle it
    return false;
  }
}

/**
 * Finalize a recovered run by calling handleCompletion on its orchestrator.
 * This extracts results, delivers them, and cleans up tracking state.
 */
async function finalizeRecoveredRun(
  run: ActiveRun,
  deps: RecoveryDeps,
): Promise<void> {
  const { ctx, config, janitorOrchestrator, reviewerOrchestrator } = deps;
  const orchestrator =
    run.orchestrator === 'janitor' ? janitorOrchestrator : reviewerOrchestrator;

  try {
    await orchestrator.handleCompletion(run.sessionId, ctx, config);
  } catch (err) {
    warn(`[recovery] handleCompletion failed for ${run.id}: ${err}`);
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
