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
import { appendEvent } from '../db/queries/event-queries';
import {
  claimNextQueuedJobWithRepoLimit,
  markJobSucceeded,
} from '../db/queries/scheduler-queries';
import { buildTriggerContext } from '../reviews/context';
import type { AgentRuntimeRegistry } from '../runtime/agent-runtime-registry';
import {
  type ManualJobPayload,
  parseReviewJobPayload,
} from '../runtime/review-job-payload';
import type { SessionCompletionBus } from '../runtime/session-completion-bus';
import {
  type AgentExecutionPipeline,
  createAgentExecutionPipeline,
} from './agent-execution-pipeline';
import {
  executeAgentsInChunks,
  selectAgents,
  summarizeExecution,
} from './job-executor';
import {
  applyJobFailurePolicy,
  persistFailedJobOutcome,
  persistSuccessfulJobOutcome,
} from './job-outcome-writer';
import { createJobSignal } from './job-signal';
import { classifyUnexpectedJobError } from './retry-policy';

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

    const payload = parseReviewJobPayload(job.payload_json, job.kind);
    const trigger = buildTriggerContext(job.path, job.subject_key, payload.sha);
    const requestedAgent =
      job.kind === 'manual' ? (payload as ManualJobPayload).agent : null;
    const selectedSpecs = selectAgents(deps, job, requestedAgent);

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

    const resultByAgent = await executeAgentsInChunks(
      pipeline,
      job,
      selectedSpecs,
      config.scheduler.agentParallelism,
      trigger,
    );

    const summary = summarizeExecution(selectedSpecs, resultByAgent);
    if (summary.failedRuns.length > 0) {
      persistFailedJobOutcome(db, config, job, summary);
      return;
    }

    persistSuccessfulJobOutcome(db, job, selectedSpecs, summary);
  } catch (error) {
    const classified = classifyUnexpectedJobError(error);
    applyJobFailurePolicy(db, config, job, classified, {
      requeueEventMessage: `Job ${job.id} requeued after failure: ${classified.message}`,
      failEventMessage: `Job ${job.id} failed: ${classified.message}`,
      requeueErrorType:
        classified.errorType === 'transient' ? 'transient' : 'unknown',
    });
  }
}
