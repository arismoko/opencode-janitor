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
  requeueReviewRun,
} from '../db/queries/review-run-queries';
import { insertFindingRows } from '../db/queries/scheduler-queries';
import { buildTriggerContextFromPayload } from '../reviews/context';
import {
  abortSession,
  createReviewSession,
  fetchAssistantOutput,
  parseModelOverride,
  promptReviewAsync,
} from '../reviews/runner';
import type { AgentRuntimeRegistry } from '../runtime/agent-runtime-registry';
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

async function processRun(
  deps: SchedulerDeps,
  run: QueuedReviewRunRow,
  activeSessions: Map<string, ActiveSession>,
): Promise<void> {
  const { db, client, config, registry, completionBus } = deps;
  const spec = registry.get(run.agent as AgentName);

  if (!spec) {
    markReviewRunFailed(
      db,
      run.id,
      'AGENT_NOT_REGISTERED',
      `No runtime spec registered for agent ${run.agent}`,
      'failed_terminal',
      JSON.stringify({ reason: 'missing-runtime-spec' }),
    );
    return;
  }

  const trigger = buildTriggerContextFromPayload(
    run.path,
    run.trigger_id,
    run.payload_json,
  );

  const pseudoJob = {
    id: run.id,
    repo_id: run.repo_id,
    trigger_id: run.trigger_event_id,
    dedupe_key: `${run.trigger_id}:${run.subject}`,
    attempt: run.attempt,
    max_attempts: run.max_attempts,
    next_attempt_at: run.next_attempt_at,
    queued_at: run.queued_at,
    path: run.path,
    default_branch: run.default_branch,
    kind: run.trigger_id,
    subject_key: run.subject,
    payload_json: run.payload_json,
  };

  const prepared = spec.prepareContext({
    config,
    job: pseudoJob,
    trigger,
  });
  const prompt = spec.buildPrompt({ preparedContext: prepared });

  const modelID = spec.modelId(config);
  const modelOverride = parseModelOverride(modelID);

  let sessionId: string | undefined;
  try {
    sessionId = await createReviewSession(client, {
      title: `[${spec.agent}] ${run.subject || run.id}`,
      directory: run.path,
    });

    markReviewRunRunning(db, run.id, sessionId);
    activeSessions.set(run.id, { sessionId, directory: run.path });

    const completion = completionBus.waitFor(sessionId, {
      directory: run.path,
    });

    await promptReviewAsync(client, {
      sessionId,
      directory: run.path,
      agent: spec.agent,
      prompt,
      modelOverride,
    });

    const completionResult = await completion;
    if (completionResult.type !== 'idle') {
      const classification = classifyCompletionFailure(completionResult.type);
      throw new Error(
        `${classification.errorCode}: ${completionResult.message ?? completionResult.type}`,
      );
    }

    const rawOutput = await fetchAssistantOutput(client, {
      sessionId,
      directory: run.path,
    });
    const parsed = spec.parseOutput(rawOutput);
    const findings = spec.onSuccess({
      job: pseudoJob,
      runId: run.id,
      output: parsed,
    });

    insertFindingRows(
      db,
      findings.map((finding) => ({
        ...finding,
        job_id: null,
        agent_run_id: null,
        review_run_id: run.id,
      })),
    );

    markReviewRunSucceeded(
      db,
      run.id,
      findings.length,
      rawOutput,
      'succeeded',
      JSON.stringify({
        outcome: 'succeeded',
        findingsCount: findings.length,
        sessionId,
      }),
    );
    appendEvent(db, {
      eventType: 'review_run.succeeded',
      repoId: run.repo_id,
      message: `Review run ${run.id} succeeded`,
      payload: { agent: run.agent, findingsCount: findings.length },
    });
  } catch (error) {
    const classification = classifyAgentFailure(error);
    const message = toErrorMessage(error);

    if (sessionId) {
      completionBus.cancel(sessionId, 'review run failed');
      await abortSession(client, sessionId, run.path);
    }

    if (classification.retryable && run.attempt < run.max_attempts) {
      requeueReviewRun(
        db,
        run.id,
        nextAttemptAt(config.scheduler.retryBackoffMs, run.attempt),
        classification.errorCode,
        message,
      );
      appendEvent(db, {
        eventType: 'review_run.requeued',
        level: 'warn',
        repoId: run.repo_id,
        message: `Review run ${run.id} requeued: ${message}`,
      });
    } else {
      markReviewRunFailed(
        db,
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
      appendEvent(db, {
        eventType: 'review_run.failed',
        level: 'error',
        repoId: run.repo_id,
        message: `Review run ${run.id} failed: ${message}`,
      });
    }
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
