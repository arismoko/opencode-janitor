/**
 * Scheduler worker — polls queued jobs and executes agent reviews.
 *
 * Uses async session execution (`promptAsync`) + daemon-wide completion bus
 * to avoid blocking per-agent runs.
 */
import type { Database } from 'bun:sqlite';
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { CliConfig } from '../config/schema';
import type { QueuedJobRow } from '../db/models';
import {
  appendEvent,
  claimNextQueuedJobWithRepoLimit,
  markJobFailed,
  markJobSucceeded,
  requeueJob,
} from '../db/queries';
import { buildTriggerContext } from '../reviews/context';
import type { AgentRuntimeRegistry } from '../runtime/agent-runtime-registry';
import type { SessionCompletionBus } from '../runtime/session-completion-bus';
import {
  type AgentExecutionPipeline,
  type AgentRunResult,
  createAgentExecutionPipeline,
} from './agent-execution-pipeline';
import { createJobSignal } from './job-signal';
import { classifyUnexpectedJobError } from './retry-policy';

const DEFAULT_STOP_TIMEOUT_MS = 10_000;
const FALLBACK_HEARTBEAT_MS = 1000;

function computeRetryBackoffMs(baseMs: number, attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return baseMs * 2 ** exponent;
}

function computeNextAttemptAt(baseMs: number, attempt: number): number {
  return Date.now() + computeRetryBackoffMs(baseMs, attempt);
}

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

export function startScheduler(deps: SchedulerDeps): SchedulerHandle {
  const active = new Set<Promise<void>>();
  const signal = createJobSignal();
  const pipeline = createAgentExecutionPipeline(deps);
  let stopped = false;
  let loopPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  const tick = () => {
    if (stopped) {
      return;
    }

    while (active.size < deps.config.scheduler.globalConcurrency) {
      const job = claimNextQueuedJobWithRepoLimit(
        deps.db,
        deps.config.scheduler.perRepoConcurrency,
      );

      if (!job) {
        break;
      }

      const promise = processJob(deps, pipeline, job)
        .catch(() => {
          // Individual job errors are handled in processJob.
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
      if (stopped) {
        break;
      }
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

        await pipeline.cancelActiveSessions(
          options?.cancelMessage ?? 'scheduler stopping',
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

function payloadSha(payloadRaw: string): string | null {
  try {
    const payload = JSON.parse(payloadRaw) as { sha?: unknown };
    return typeof payload.sha === 'string' ? payload.sha : null;
  } catch {
    return null;
  }
}

async function processJob(
  deps: SchedulerDeps,
  pipeline: AgentExecutionPipeline,
  job: QueuedJobRow,
): Promise<void> {
  const { db, config, registry } = deps;

  try {
    appendEvent(db, {
      eventType: 'job.started',
      message: `Job ${job.id} started (attempt ${job.attempt})`,
      level: 'info',
      repoId: job.repo_id,
      jobId: job.id,
    });

    const sha = payloadSha(job.payload_json);
    const trigger = buildTriggerContext(job.path, job.subject_key, sha);

    // If the trigger payload specifies a single agent, filter to just that agent.
    const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
    const requestedAgent =
      typeof payload.agent === 'string' ? payload.agent : null;

    const selectedSpecs = registry.agents().filter((spec) => {
      if (requestedAgent) {
        const agentConfig = config.agents[spec.agent];
        return (
          spec.agent === requestedAgent &&
          agentConfig.enabled &&
          agentConfig.trigger !== 'never'
        );
      }
      return spec.supportsTrigger(config, job.kind);
    });

    if (selectedSpecs.length === 0) {
      markJobSucceeded(db, job.id);
      appendEvent(db, {
        eventType: 'job.finished',
        message: `Job ${job.id} finished — no agents enabled for trigger "${job.kind}"`,
        level: 'info',
        repoId: job.repo_id,
        jobId: job.id,
      });
      return;
    }

    const parallelism = config.scheduler.agentParallelism;
    const allResults: AgentRunResult[] = [];

    for (let i = 0; i < selectedSpecs.length; i += parallelism) {
      const chunk = selectedSpecs.slice(i, i + parallelism);
      const chunkResults = await Promise.all(
        chunk.map((spec) => pipeline.execute(job, spec, trigger)),
      );
      allResults.push(...chunkResults);
    }

    const totalFindings = allResults.reduce(
      (sum, result) => sum + result.findingsCount,
      0,
    );
    const agentRuns = selectedSpecs.map((spec, index) => {
      const result = allResults[index];
      return {
        agent: spec.agent,
        outcome: result?.outcome ?? 'failed_terminal',
        findingsCount: result?.findingsCount ?? 0,
        retryable: result?.retryable ?? false,
        errorCode: result?.errorCode,
        durationMs: result?.summary.durationMs ?? 0,
      };
    });
    const failedRuns = selectedSpecs
      .map((spec, index) => ({ spec, result: allResults[index] }))
      .filter(
        (
          entry,
        ): entry is {
          spec: (typeof selectedSpecs)[number];
          result: AgentRunResult;
        } => !entry.result?.success,
      );

    if (failedRuns.length > 0) {
      const allRetryable = failedRuns.every((entry) => entry.result.retryable);
      const failedAgentDetails = failedRuns.map(
        (entry) =>
          `${entry.spec.agent}:${entry.result.errorCode ?? entry.result.outcome}`,
      );
      const message = `agent(s) failed: ${failedAgentDetails.join(', ')}`;

      if (allRetryable && job.attempt < job.max_attempts) {
        const nextAttemptAt = computeNextAttemptAt(
          config.scheduler.retryBackoffMs,
          job.attempt,
        );
        requeueJob(
          db,
          job.id,
          'JOB_RETRY_TRANSIENT',
          message,
          nextAttemptAt,
          'transient',
        );
        appendEvent(db, {
          eventType: 'job.requeued',
          message: `Job ${job.id} requeued after transient agent failure: ${message}`,
          level: 'warn',
          repoId: job.repo_id,
          jobId: job.id,
          payload: {
            failedAgents: failedRuns.map((entry) => entry.spec.agent),
            reasons: failedAgentDetails,
            agentRuns,
          },
        });
        return;
      }

      const hasCancelled = failedRuns.some(
        (entry) => entry.result.outcome === 'cancelled',
      );
      const errorCode = hasCancelled
        ? 'JOB_ERROR_CANCELLED'
        : 'JOB_ERROR_TERMINAL';
      const errorType = hasCancelled ? 'cancelled' : 'terminal';

      markJobFailed(db, job.id, errorCode, message, errorType);
      appendEvent(db, {
        eventType: 'job.failed',
        message: `Job ${job.id} failed: ${message}`,
        level: 'error',
        repoId: job.repo_id,
        jobId: job.id,
        payload: {
          failedAgents: failedRuns.map((entry) => entry.spec.agent),
          reasons: failedAgentDetails,
          agentRuns,
        },
      });
      return;
    }

    markJobSucceeded(db, job.id);
    appendEvent(db, {
      eventType: 'job.finished',
      message: `Job ${job.id} finished with ${totalFindings} finding(s) across ${selectedSpecs.length} agent(s)`,
      level: 'info',
      repoId: job.repo_id,
      jobId: job.id,
      payload: {
        findingsCount: totalFindings,
        agents: selectedSpecs.map((spec) => spec.agent),
        agentRuns,
      },
    });
  } catch (error) {
    const classified = classifyUnexpectedJobError(error);
    const message = classified.message;

    if (classified.retryable && job.attempt < job.max_attempts) {
      const nextAttemptAt = computeNextAttemptAt(
        config.scheduler.retryBackoffMs,
        job.attempt,
      );
      requeueJob(
        db,
        job.id,
        classified.errorCode,
        message,
        nextAttemptAt,
        classified.errorType === 'transient' ? 'transient' : 'unknown',
      );
      appendEvent(db, {
        eventType: 'job.requeued',
        message: `Job ${job.id} requeued after failure: ${message}`,
        level: 'warn',
        repoId: job.repo_id,
        jobId: job.id,
      });
      return;
    }

    markJobFailed(
      db,
      job.id,
      classified.errorCode,
      message,
      classified.errorType,
    );
    appendEvent(db, {
      eventType: 'job.failed',
      message: `Job ${job.id} failed: ${message}`,
      level: 'error',
      repoId: job.repo_id,
      jobId: job.id,
    });
  }
}
