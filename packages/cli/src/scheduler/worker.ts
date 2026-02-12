import type { Database } from 'bun:sqlite';
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { AgentName } from '@opencode-janitor/shared';
import type { CliConfig } from '../config/schema';
import { appendEvent } from '../db/queries/event-queries';
import {
  claimNextQueuedReviewRun,
  markReviewRunFailed,
  markReviewRunRunning,
  markReviewRunSucceeded,
  type QueuedReviewRunRow,
  replaceReviewRunFindings,
  requeueReviewRun,
} from '../db/queries/review-run-queries';
import { buildTriggerContextFromPayload } from '../reviews/context';
import {
  abortSession,
  createReviewSession,
  fetchAssistantOutput,
  parseModelOverride,
  promptReviewAsync,
} from '../reviews/runner';
import type { AgentRuntimeRegistry } from '../runtime/agent-runtime-registry';
import type { AgentRuntimeSpec } from '../runtime/agent-runtime-spec';
import type { SessionCompletionBus } from '../runtime/session-completion-bus';
import {
  classifyAgentFailure,
  classifyCompletionFailure,
} from './retry-policy';

const DEFAULT_STOP_TIMEOUT_MS = 10_000;
const FALLBACK_HEARTBEAT_MS = 1000;

export interface SchedulerDeps {
  db: Database;
  client: OpencodeClient;
  config: CliConfig;
  registry: AgentRuntimeRegistry;
  completionBus: SessionCompletionBus;
}

export interface SchedulerHandle {
  wake(): void;
  stop(options?: { timeoutMs?: number; cancelMessage?: string }): Promise<void>;
}

interface ActiveSession {
  sessionId: string;
  directory: string;
}

function now(): number {
  return Date.now();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nextAttemptAt(baseMs: number, attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return now() + baseMs * 2 ** exponent;
}

function createSignal() {
  let resolver: (() => void) | null = null;
  return {
    notify() {
      resolver?.();
      resolver = null;
    },
    wait(timeoutMs: number) {
      return new Promise<void>((resolve) => {
        resolver = resolve;
        setTimeout(() => {
          if (resolver === resolve) {
            resolver = null;
            resolve();
          }
        }, timeoutMs);
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1: Prepare run context — resolve spec, trigger, prompt, model
// ─────────────────────────────────────────────────────────────────────────────
interface PreparedRun {
  spec: AgentRuntimeSpec;
  prompt: string;
  modelOverride: ReturnType<typeof parseModelOverride>;
  runtimeRun: {
    id: string;
    repo_id: string;
    trigger_event_id: string;
    trigger_id: 'commit' | 'pr' | 'manual';
    scope: 'commit-diff' | 'workspace-diff' | 'repo' | 'pr';
    path: string;
    default_branch: string;
  };
}

export function prepareRunContext(
  deps: Pick<SchedulerDeps, 'config' | 'registry'>,
  run: QueuedReviewRunRow,
): PreparedRun | { error: string } {
  const spec = deps.registry.get(run.agent as AgentName);
  if (!spec) {
    return { error: `No runtime spec registered for agent ${run.agent}` };
  }

  const trigger = buildTriggerContextFromPayload(
    run.path,
    run.trigger_id,
    run.payload_json,
  );

  const runtimeRun = {
    id: run.id,
    repo_id: run.repo_id,
    trigger_event_id: run.trigger_event_id,
    trigger_id: run.trigger_id as 'commit' | 'pr' | 'manual',
    scope: run.scope as 'commit-diff' | 'workspace-diff' | 'repo' | 'pr',
    path: run.path,
    default_branch: run.default_branch,
  };

  const prepared = spec.prepareContext({
    config: deps.config,
    run: runtimeRun,
    trigger,
  });
  const prompt = spec.buildPrompt({ preparedContext: prepared });
  const modelID = spec.modelId(deps.config);
  const modelOverride = parseModelOverride(modelID);

  return { spec, prompt, modelOverride, runtimeRun };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2: Execute session — create, prompt, await completion
// ─────────────────────────────────────────────────────────────────────────────
interface SessionResult {
  sessionId: string;
  rawOutput: string;
}

export async function executeSession(
  deps: Pick<SchedulerDeps, 'client' | 'completionBus'>,
  run: QueuedReviewRunRow,
  prepared: PreparedRun,
  onSessionCreated?: (sessionId: string) => void,
): Promise<SessionResult> {
  const sessionId = await createReviewSession(deps.client, {
    title: `[${prepared.spec.agent}] ${run.subject || run.id}`,
    directory: run.path,
  });

  onSessionCreated?.(sessionId);

  const completion = deps.completionBus.waitFor(sessionId, {
    directory: run.path,
  });

  await promptReviewAsync(deps.client, {
    sessionId,
    directory: run.path,
    agent: prepared.spec.agent,
    prompt: prepared.prompt,
    modelOverride: prepared.modelOverride,
  });

  const completionResult = await completion;
  if (completionResult.type !== 'idle') {
    const classification = classifyCompletionFailure(completionResult.type);
    throw new Error(
      `${classification.errorCode}: ${completionResult.message ?? completionResult.type}`,
    );
  }

  const rawOutput = await fetchAssistantOutput(deps.client, {
    sessionId,
    directory: run.path,
  });

  return { sessionId, rawOutput };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3: Persist success — parse output, store findings, mark succeeded
// ─────────────────────────────────────────────────────────────────────────────
export function persistSuccess(
  deps: Pick<SchedulerDeps, 'db'>,
  run: QueuedReviewRunRow,
  prepared: PreparedRun,
  session: SessionResult,
): void {
  const parsed = prepared.spec.parseOutput(session.rawOutput);
  const findings = prepared.spec.onSuccess({
    run: prepared.runtimeRun,
    reviewRunId: run.id,
    output: parsed,
  });

  replaceReviewRunFindings(deps.db, run.id, findings);

  markReviewRunSucceeded(
    deps.db,
    run.id,
    findings.length,
    session.rawOutput,
    'succeeded',
    JSON.stringify({
      outcome: 'succeeded',
      findingsCount: findings.length,
      sessionId: session.sessionId,
    }),
  );
  appendEvent(deps.db, {
    eventType: 'review_run.succeeded',
    repoId: run.repo_id,
    triggerEventId: run.trigger_event_id,
    reviewRunId: run.id,
    message: `Review run ${run.id} succeeded`,
    payload: {
      agent: run.agent,
      findingsCount: findings.length,
      reviewRunId: run.id,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 4: Persist failure or retry — classify, requeue or mark failed
// ─────────────────────────────────────────────────────────────────────────────
export function persistFailureOrRetry(
  deps: Pick<SchedulerDeps, 'db' | 'config'>,
  run: QueuedReviewRunRow,
  error: unknown,
): void {
  const classification = classifyAgentFailure(error);
  const message = toErrorMessage(error);

  if (classification.retryable && run.attempt < run.max_attempts) {
    requeueReviewRun(
      deps.db,
      run.id,
      nextAttemptAt(deps.config.scheduler.retryBackoffMs, run.attempt),
      classification.errorCode,
      message,
    );
    appendEvent(deps.db, {
      eventType: 'review_run.requeued',
      level: 'warn',
      repoId: run.repo_id,
      triggerEventId: run.trigger_event_id,
      reviewRunId: run.id,
      message: `Review run ${run.id} requeued: ${message}`,
      payload: {
        agent: run.agent,
        reviewRunId: run.id,
      },
    });
  } else {
    markReviewRunFailed(
      deps.db,
      run.id,
      classification.errorCode,
      message,
      classification.outcome,
      JSON.stringify({
        outcome: classification.outcome,
        retryable: classification.retryable,
        errorType: classification.errorType,
      }),
    );
    appendEvent(deps.db, {
      eventType: 'review_run.failed',
      level: 'error',
      repoId: run.repo_id,
      triggerEventId: run.trigger_event_id,
      reviewRunId: run.id,
      message: `Review run ${run.id} failed: ${message}`,
      payload: {
        agent: run.agent,
        errorCode: classification.errorCode,
        reviewRunId: run.id,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — wires stages together
// ─────────────────────────────────────────────────────────────────────────────
async function processRun(
  deps: SchedulerDeps,
  run: QueuedReviewRunRow,
  activeSessions: Map<string, ActiveSession>,
): Promise<void> {
  const { db, client, completionBus } = deps;

  // Stage 1: prepare
  const prepared = prepareRunContext(deps, run);
  if ('error' in prepared) {
    markReviewRunFailed(
      db,
      run.id,
      'AGENT_NOT_REGISTERED',
      prepared.error,
      'failed_terminal',
      JSON.stringify({ reason: 'missing-runtime-spec' }),
    );
    return;
  }

  let sessionId: string | undefined;
  try {
    // Stage 2: execute
    // Create session first to get sessionId for tracking, then mark as running
    const session = await executeSession(deps, run, prepared, (sid) => {
      sessionId = sid;
      markReviewRunRunning(db, run.id, sid);
      activeSessions.set(run.id, { sessionId: sid, directory: run.path });
    });
    sessionId = session.sessionId;

    // Ensure active tracking is set even if callback timing differs
    if (!activeSessions.has(run.id)) {
      activeSessions.set(run.id, { sessionId, directory: run.path });
    }

    // Stage 3: persist success
    persistSuccess(deps, run, prepared, session);
  } catch (error) {
    if (sessionId) {
      completionBus.cancel(sessionId, 'review run failed');
      await abortSession(client, sessionId, run.path);
    }

    // Stage 4: persist failure or retry
    persistFailureOrRetry(deps, run, error);
  } finally {
    activeSessions.delete(run.id);
  }
}

export function startScheduler(deps: SchedulerDeps): SchedulerHandle {
  const active = new Set<Promise<void>>();
  const activeSessions = new Map<string, ActiveSession>();
  const signal = createSignal();
  let stopped = false;
  let loopPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  const tick = () => {
    if (stopped) {
      return;
    }

    while (active.size < deps.config.scheduler.globalConcurrency) {
      const run = claimNextQueuedReviewRun(
        deps.db,
        deps.config.scheduler.perRepoConcurrency,
      );
      if (!run) {
        break;
      }

      const promise = processRun(deps, run, activeSessions)
        .catch(() => {
          // processRun persists failures and never rethrows intentionally.
        })
        .finally(() => {
          active.delete(promise);
          signal.notify();
        });
      active.add(promise);
    }
  };

  const runLoop = async () => {
    while (!stopped) {
      tick();
      if (stopped) break;
      await signal.wait(FALLBACK_HEARTBEAT_MS);
    }
  };

  loopPromise = runLoop();

  return {
    wake() {
      signal.notify();
    },
    stop(options) {
      if (stopPromise) {
        return stopPromise;
      }

      stopPromise = (async () => {
        stopped = true;
        signal.notify();
        await loopPromise;
        loopPromise = undefined;

        const cancelMessage = options?.cancelMessage ?? 'scheduler stopping';
        await Promise.allSettled(
          [...activeSessions.values()].map((activeSession) => {
            deps.completionBus.cancel(activeSession.sessionId, cancelMessage);
            return abortSession(
              deps.client,
              activeSession.sessionId,
              activeSession.directory,
            );
          }),
        );

        const settleAll = Promise.allSettled([...active]);
        const timeoutMs = options?.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
        if (timeoutMs <= 0) {
          await settleAll;
          return;
        }
        await Promise.race([settleAll, Bun.sleep(timeoutMs)]);
      })();

      return stopPromise;
    },
  };
}
