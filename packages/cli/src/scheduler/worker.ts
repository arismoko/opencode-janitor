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
import { buildCommitContext, resolveCommitSha } from '../reviews/context';
import type { AgentRuntimeRegistry } from '../runtime/agent-runtime-registry';
import type { SessionCompletionBus } from '../runtime/session-completion-bus';
import {
  type AgentExecutionPipeline,
  type AgentRunResult,
  createAgentExecutionPipeline,
} from './agent-execution-pipeline';
import { classifyUnexpectedJobError } from './retry-policy';

const DEFAULT_STOP_TIMEOUT_MS = 10_000;

export interface SchedulerDeps {
  db: Database;
  client: OpencodeClient;
  config: CliConfig;
  registry: AgentRuntimeRegistry;
  completionBus: SessionCompletionBus;
}

export interface SchedulerHandle {
  stop(options?: { timeoutMs?: number; cancelMessage?: string }): Promise<void>;
}

export function startScheduler(deps: SchedulerDeps): SchedulerHandle {
  const active = new Set<Promise<void>>();
  const pipeline = createAgentExecutionPipeline(deps);
  let stopped = false;
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
        });

      active.add(promise);
    }
  };

  const interval = setInterval(tick, 500);

  return {
    stop(options) {
      if (stopPromise) {
        return stopPromise;
      }

      stopPromise = (async () => {
        stopped = true;
        clearInterval(interval);

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

    const sha =
      payloadSha(job.payload_json) ??
      resolveCommitSha(job.path, job.subject_key);
    const commit = buildCommitContext(job.path, sha);

    const selectedSpecs = registry
      .agents()
      .filter((spec) => spec.supportsTrigger(config, job.kind));

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
        chunk.map((spec) => pipeline.execute(job, spec, sha, commit)),
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
        requeueJob(db, job.id, 'JOB_RETRY_TRANSIENT', message, 'transient');
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
      requeueJob(
        db,
        job.id,
        classified.errorCode,
        message,
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
