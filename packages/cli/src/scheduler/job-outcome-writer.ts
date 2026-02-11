import type { Database } from 'bun:sqlite';
import type { CliConfig } from '../config/schema';
import type { QueuedJobRow } from '../db/models';
import { appendEvent } from '../db/queries/event-queries';
import {
  markJobFailed,
  markJobSucceeded,
  requeueJob,
} from '../db/queries/scheduler-queries';
import type { AgentRunResult } from './agent-execution-pipeline';
import type { JobExecutionSummary } from './job-executor';
import type { SchedulerDeps } from './worker';

export interface FailurePolicyClassification {
  retryable: boolean;
  errorCode: string;
  errorType: 'terminal' | 'transient' | 'cancelled' | 'unknown';
  message: string;
}

export interface FailurePolicyContext {
  requeueEventMessage: string;
  failEventMessage: string;
  payload?: Record<string, unknown>;
  requeueErrorType?: 'transient' | 'cancelled' | 'unknown';
}

export function computeRetryBackoffMs(baseMs: number, attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return baseMs * 2 ** exponent;
}

export function computeNextAttemptAt(baseMs: number, attempt: number): number {
  return Date.now() + computeRetryBackoffMs(baseMs, attempt);
}

export function persistSuccessfulJobOutcome(
  db: Database,
  job: QueuedJobRow,
  selectedSpecs: ReturnType<SchedulerDeps['registry']['agents']>,
  summary: JobExecutionSummary,
): void {
  markJobSucceeded(db, job.id);
  appendEvent(db, {
    eventType: 'job.finished',
    message: `Job ${job.id} finished with ${summary.totalFindings} finding(s) across ${selectedSpecs.length} agent(s)`,
    level: 'info',
    repoId: job.repo_id,
    jobId: job.id,
    payload: {
      findingsCount: summary.totalFindings,
      agents: selectedSpecs.map((spec) => spec.agent),
      agentRuns: summary.agentRuns,
    },
  });
}

export function persistFailedJobOutcome(
  db: Database,
  config: CliConfig,
  job: QueuedJobRow,
  summary: JobExecutionSummary,
): void {
  const allRetryable = summary.failedRuns.every(
    (entry) => entry.result.retryable,
  );
  const failedAgentDetails = summary.failedRuns.map(
    (entry) =>
      `${entry.agent}:${entry.result.errorCode ?? entry.result.outcome}`,
  );
  const message = `agent(s) failed: ${failedAgentDetails.join(', ')}`;

  const hasCancelled = summary.failedRuns.some(
    (entry) => entry.result.outcome === 'cancelled',
  );
  const classification: FailurePolicyClassification = allRetryable
    ? {
        retryable: true,
        errorCode: 'JOB_RETRY_TRANSIENT',
        errorType: 'transient',
        message,
      }
    : {
        retryable: false,
        errorCode: hasCancelled ? 'JOB_ERROR_CANCELLED' : 'JOB_ERROR_TERMINAL',
        errorType: hasCancelled ? 'cancelled' : 'terminal',
        message,
      };

  applyJobFailurePolicy(db, config, job, classification, {
    requeueEventMessage: `Job ${job.id} requeued after transient agent failure: ${message}`,
    failEventMessage: `Job ${job.id} failed: ${message}`,
    payload: {
      failedAgents: summary.failedRuns.map((entry) => entry.agent),
      reasons: failedAgentDetails,
      agentRuns: summary.agentRuns,
    },
    requeueErrorType: 'transient',
  });
}

export function applyJobFailurePolicy(
  db: Database,
  config: CliConfig,
  job: QueuedJobRow,
  classification: FailurePolicyClassification,
  context: FailurePolicyContext,
): 'requeued' | 'failed' {
  if (classification.retryable && job.attempt < job.max_attempts) {
    const nextAttemptAt = computeNextAttemptAt(
      config.scheduler.retryBackoffMs,
      job.attempt,
    );
    requeueJob(
      db,
      job.id,
      classification.errorCode,
      classification.message,
      nextAttemptAt,
      context.requeueErrorType ??
        (classification.errorType === 'transient'
          ? 'transient'
          : classification.errorType === 'cancelled'
            ? 'cancelled'
            : 'unknown'),
    );
    appendEvent(db, {
      eventType: 'job.requeued',
      message: context.requeueEventMessage,
      level: 'warn',
      repoId: job.repo_id,
      jobId: job.id,
      ...(context.payload ? { payload: context.payload } : {}),
    });
    return 'requeued';
  }

  markJobFailed(
    db,
    job.id,
    classification.errorCode,
    classification.message,
    classification.errorType,
  );
  appendEvent(db, {
    eventType: 'job.failed',
    message: context.failEventMessage,
    level: 'error',
    repoId: job.repo_id,
    jobId: job.id,
    ...(context.payload ? { payload: context.payload } : {}),
  });
  return 'failed';
}
