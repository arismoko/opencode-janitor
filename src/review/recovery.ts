/**
 * Crash recovery — salvage interrupted review sessions after restart.
 *
 * Recovery philosophy: **inspect, don't guess.**
 *
 * The previous implementation used blind TTL timers to expire recovered runs.
 * This worked for liveness (never block the queue) but sacrificed correctness:
 * a session that was 99% done generating its review would be killed and lost.
 *
 * The new approach actually inspects the LLM session's messages to decide
 * what happened and what to do about it:
 *
 *   1. Fetch session status (busy/idle/gone)
 *   2. If busy, poll until idle (max 120s)
 *   3. Inspect the last assistant message:
 *      - Interrupted (no time.completed) → send "continue" prompt
 *      - Completed with text output → try handleCompletion (parse + deliver)
 *      - Completed without text → treat as interrupted, send "continue"
 *      - Errored → log and give up
 *   4. After sending continue/retry, poll until idle and re-inspect
 *   5. Max 2 recovery cycles per run, then give up gracefully
 *
 * This preserves liveness (bounded polls, max attempts) while dramatically
 * improving result salvage rates. A review interrupted mid-JSON-output can
 * now be continued and completed instead of being discarded.
 *
 * All reattached runs are bounded by MAX_RECOVERY_ATTEMPTS. If recovery
 * exhausts all attempts, handleCompletion is called one final time to let
 * the orchestrator clean up its tracking state (mark job failed, free
 * concurrency slot, fire onRunTerminal).
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import type { PrContext } from '../git/pr-context-resolver';
import type { ActiveRun, ReviewRunStore } from '../state/review-run-store';
import { withTimeout } from '../utils/async';
import { getErrorMessage, log, warn } from '../utils/logger';
import type { BaseOrchestrator } from './base-orchestrator';

/** Maximum number of continue/retry cycles per recovered run. */
const MAX_RECOVERY_ATTEMPTS = 2;

/** Interval between session status polls (ms). */
const POLL_INTERVAL_MS = 2_000;

/** Maximum time to wait for a busy session to become idle (ms). */
const MAX_POLL_MS = 120_000;

/** Timeout for the initial session.status() fetch (ms). */
const STATUS_TIMEOUT_MS = 3_000;

/** Maximum age of a journaled run before it's pruned as stale (24h). */
const RUN_TTL_MS = 24 * 60 * 60 * 1000;

/** Result of inspecting a session's last assistant message. */
type SessionInspection =
  | { state: 'completed'; hasTextOutput: boolean }
  | { state: 'interrupted' }
  | { state: 'no-messages' }
  | { state: 'errored'; error: string };

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

// ---------------------------------------------------------------------------
// Helper: resolve the agent name for a given orchestrator type
// ---------------------------------------------------------------------------

function agentForRun(run: ActiveRun): string {
  return run.orchestrator === 'janitor' ? 'janitor' : 'code-reviewer';
}

// ---------------------------------------------------------------------------
// Helper: resolve the orchestrator instance for a given run
// ---------------------------------------------------------------------------

function orchestratorForRun(
  run: ActiveRun,
  deps: RecoveryDeps,
): BaseOrchestrator<string, unknown> | BaseOrchestrator<PrContext, unknown> {
  return run.orchestrator === 'janitor'
    ? deps.janitorOrchestrator
    : deps.reviewerOrchestrator;
}

// ---------------------------------------------------------------------------
// Poll until idle
// ---------------------------------------------------------------------------

/**
 * Poll session.status() every POLL_INTERVAL_MS until the given session
 * reports "idle", or until `maxMs` elapses.
 *
 * @returns `true` if the session became idle, `false` on timeout.
 */
async function pollUntilIdle(
  ctx: PluginInput,
  sessionId: string,
  maxMs: number,
): Promise<boolean> {
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    try {
      const result = await ctx.client.session.status();
      const statusMap = (result.data ?? {}) as Record<
        string,
        { type?: string }
      >;
      const type = statusMap[sessionId]?.type;

      if (type === 'idle') return true;
      if (type === undefined) {
        // Session gone — treat as "idle enough" so caller can inspect
        return true;
      }
    } catch {
      // Transient status fetch failure — keep polling
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Inspect session messages
// ---------------------------------------------------------------------------

/**
 * Fetch the session's messages and inspect the last assistant message
 * to determine what state the session is in.
 */
async function inspectSession(
  ctx: PluginInput,
  sessionId: string,
): Promise<SessionInspection> {
  const messagesResult = await ctx.client.session.messages({
    path: { id: sessionId },
  });
  const messages = (messagesResult.data ?? []) as Array<{
    info?: {
      role: string;
      time?: { created: number; completed?: number };
      error?: { type?: string; message?: string } | string;
    };
    parts?: Array<{ type: string; text?: string }>;
  }>;

  // Find the last assistant message (iterate from end)
  let lastAssistant: (typeof messages)[number] | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info?.role === 'assistant') {
      lastAssistant = messages[i];
      break;
    }
  }

  if (!lastAssistant) {
    return { state: 'no-messages' };
  }

  // Check for error on the assistant message
  const errorField = lastAssistant.info?.error;
  if (errorField) {
    const errorStr =
      typeof errorField === 'string'
        ? errorField
        : (errorField.message ?? errorField.type ?? 'unknown error');
    return { state: 'errored', error: errorStr };
  }

  // Check if the message was completed
  const completed = lastAssistant.info?.time?.completed;
  if (completed === undefined) {
    return { state: 'interrupted' };
  }

  // Message completed — check if it has text output
  const hasTextOutput = (lastAssistant.parts ?? []).some(
    (p) => p.type === 'text' && p.text && p.text.trim().length > 0,
  );

  return { state: 'completed', hasTextOutput };
}

// ---------------------------------------------------------------------------
// Send continue / retry messages
// ---------------------------------------------------------------------------

/**
 * Send a "continue" message to resume an interrupted session.
 */
async function sendContinue(
  ctx: PluginInput,
  sessionId: string,
  run: ActiveRun,
): Promise<void> {
  log(`[recovery] sending continue to ${run.id} (session ${sessionId})`);
  await ctx.client.session.promptAsync({
    path: { id: sessionId },
    body: {
      agent: agentForRun(run),
      parts: [
        {
          type: 'text' as const,
          text: 'Your previous response was interrupted. Please continue and complete your review output.',
        },
      ],
    } as any,
    query: { directory: ctx.directory },
  });
}

/**
 * Send a "retry" message when handleCompletion failed (parse error, etc.).
 */
async function sendRetry(
  ctx: PluginInput,
  sessionId: string,
  run: ActiveRun,
  error: string,
): Promise<void> {
  log(`[recovery] sending retry to ${run.id} (session ${sessionId}): ${error}`);
  await ctx.client.session.promptAsync({
    path: { id: sessionId },
    body: {
      agent: agentForRun(run),
      parts: [
        {
          type: 'text' as const,
          text: `Your review output could not be parsed: ${error}. Please output your complete review findings as a valid JSON object.`,
        },
      ],
    } as any,
    query: { directory: ctx.directory },
  });
}

// ---------------------------------------------------------------------------
// Per-run recovery logic
// ---------------------------------------------------------------------------

/**
 * Recover a single run: inspect its session, send continue/retry as needed,
 * and attempt to finalize via handleCompletion.
 */
async function recoverRun(run: ActiveRun, deps: RecoveryDeps): Promise<void> {
  const { ctx, config, runStore } = deps;
  const orchestrator = orchestratorForRun(run, deps);

  // Step 1: Check current session status
  let statusMap: Record<string, { type?: string }>;
  try {
    const statusResult = await ctx.client.session.status();
    statusMap = (statusResult.data ?? {}) as Record<string, { type?: string }>;
  } catch (err) {
    warn(
      `[recovery] failed to fetch status for ${run.id}: ${getErrorMessage(err)} — skipping`,
    );
    return;
  }

  const sessionType = statusMap[run.sessionId]?.type;

  // Session gone — clean up
  if (sessionType === undefined) {
    log(`[recovery] session gone for ${run.id} — removing from journal`);
    runStore.complete(run.id);
    return;
  }

  // If busy, wait for it to become idle
  if (sessionType === 'busy' || sessionType === 'retry') {
    log(
      `[recovery] ${run.id} is ${sessionType} — polling until idle (max ${MAX_POLL_MS}ms)`,
    );
    const becameIdle = await pollUntilIdle(ctx, run.sessionId, MAX_POLL_MS);
    if (!becameIdle) {
      warn(
        `[recovery] ${run.id} still busy after ${MAX_POLL_MS}ms — giving up`,
      );
      await finalCleanup(run, orchestrator, ctx, config, runStore);
      return;
    }
  }

  // Step 2: Inspect + recovery loop
  for (let attempt = 0; attempt < MAX_RECOVERY_ATTEMPTS; attempt++) {
    const inspection = await inspectSession(ctx, run.sessionId);
    log(
      `[recovery] ${run.id} inspection (attempt ${attempt + 1}/${MAX_RECOVERY_ATTEMPTS}): ${inspection.state}${
        inspection.state === 'completed'
          ? ` hasText=${inspection.hasTextOutput}`
          : ''
      }`,
    );

    switch (inspection.state) {
      case 'errored': {
        warn(
          `[recovery] ${run.id} has errored assistant message: ${inspection.error} — giving up`,
        );
        await finalCleanup(run, orchestrator, ctx, config, runStore);
        return;
      }

      case 'no-messages':
      case 'interrupted': {
        // Session was interrupted or has no output yet — send continue
        await sendContinue(ctx, run.sessionId, run);

        const becameIdle = await pollUntilIdle(ctx, run.sessionId, MAX_POLL_MS);
        if (!becameIdle) {
          warn(`[recovery] ${run.id} still busy after continue — giving up`);
          await finalCleanup(run, orchestrator, ctx, config, runStore);
          return;
        }
        // Loop back to re-inspect
        continue;
      }

      case 'completed': {
        if (!inspection.hasTextOutput) {
          // Completed but no text — likely only reasoning/tool parts.
          // Treat like interrupted: send continue to elicit text output.
          await sendContinue(ctx, run.sessionId, run);

          const becameIdle = await pollUntilIdle(
            ctx,
            run.sessionId,
            MAX_POLL_MS,
          );
          if (!becameIdle) {
            warn(
              `[recovery] ${run.id} still busy after continue (no text) — giving up`,
            );
            await finalCleanup(run, orchestrator, ctx, config, runStore);
            return;
          }
          // Loop back to re-inspect
          continue;
        }

        // Has text output — try handleCompletion
        try {
          await orchestrator.handleCompletion(run.sessionId, ctx, config);
          log(`[recovery] ${run.id} completed successfully`);
          // handleCompletion cleans up orchestrator tracking + fires onRunTerminal
          // which calls runStore.complete via bindRunTracking. No explicit cleanup needed.
          return;
        } catch (err) {
          const errMsg = getErrorMessage(err);
          warn(`[recovery] handleCompletion failed for ${run.id}: ${errMsg}`);

          // If we have attempts left, send retry and re-inspect
          if (attempt + 1 < MAX_RECOVERY_ATTEMPTS) {
            await sendRetry(ctx, run.sessionId, run, errMsg);

            const becameIdle = await pollUntilIdle(
              ctx,
              run.sessionId,
              MAX_POLL_MS,
            );
            if (!becameIdle) {
              warn(`[recovery] ${run.id} still busy after retry — giving up`);
              await finalCleanup(run, orchestrator, ctx, config, runStore);
              return;
            }
            // Loop back to re-inspect
            continue;
          }
          // No attempts left — fall through to exhaustion cleanup below
        }
        break;
      }
    }
  }

  // All recovery attempts exhausted
  warn(
    `[recovery] ${run.id} exhausted ${MAX_RECOVERY_ATTEMPTS} recovery attempts — giving up`,
  );
  await finalCleanup(run, orchestrator, ctx, config, runStore);
}

/**
 * Final cleanup when recovery gives up on a run.
 *
 * Calls handleCompletion one last time to let the orchestrator clean up
 * its internal tracking state (mark job failed, free concurrency slot,
 * fire onRunTerminal). If handleCompletion succeeds — great, we salvaged
 * partial output. If it fails — the orchestrator still cleans up in its
 * finally block, which is what we need.
 *
 * Then ensures the journal entry is removed.
 */
async function finalCleanup(
  run: ActiveRun,
  orchestrator:
    | BaseOrchestrator<string, unknown>
    | BaseOrchestrator<PrContext, unknown>,
  ctx: PluginInput,
  config: JanitorConfig,
  runStore: ReviewRunStore,
): Promise<void> {
  try {
    await orchestrator.handleCompletion(run.sessionId, ctx, config);
  } catch {
    // Expected — handleCompletion's finally block still cleans up tracking
  }
  // Belt-and-suspenders: ensure journal entry is removed even if
  // onRunTerminal didn't fire (e.g. session wasn't in orchestrator's map)
  runStore.complete(run.id);
}

// ---------------------------------------------------------------------------
// Reattach run to orchestrator tracking
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

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

  log(`[recovery] found ${activeRuns.length} journaled run(s) to recover`);

  // Load session statuses with timeout. On failure, clean up all journal
  // entries and accept the lost reviews — next commit/PR will retrigger.
  let statusMap: Record<string, { type?: string }>;
  try {
    const statusResult = await withTimeout(
      ctx.client.session.status(),
      STATUS_TIMEOUT_MS,
      'session.status',
    );
    statusMap = (statusResult.data ?? {}) as Record<string, { type?: string }>;
  } catch (err) {
    warn(
      `[recovery] failed to load session statuses: ${getErrorMessage(err)} — clearing journal`,
    );
    for (const run of activeRuns) {
      runStore.complete(run.id);
    }
    return;
  }

  for (const run of activeRuns) {
    const type = statusMap[run.sessionId]?.type;

    // Session gone — clean up journal entry
    if (type === undefined) {
      log(`[recovery] session gone for ${run.id} — removing from journal`);
      runStore.complete(run.id);
      continue;
    }

    // Reattach to restore sessionToKey mapping before any recovery actions
    const attached = reattachRun(
      run,
      janitorOrchestrator,
      reviewerOrchestrator,
    );
    if (!attached) {
      log(
        `[recovery] failed to reattach ${run.id} — already tracked or missing parent`,
      );
      runStore.complete(run.id);
      continue;
    }

    log(`[recovery] reattached ${run.id} (status=${type}) — starting recovery`);

    try {
      await recoverRun(run, deps);
    } catch (err) {
      warn(
        `[recovery] unexpected error recovering ${run.id}: ${getErrorMessage(err)}`,
      );
      // Ensure cleanup even on unexpected errors
      await finalCleanup(
        run,
        orchestratorForRun(run, deps),
        ctx,
        config,
        runStore,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
