import type { Database } from 'bun:sqlite';
import { appendEvent } from '../db/queries/event-queries';
import {
  markReviewRunFailed,
  markReviewRunSucceeded,
  type QueuedReviewRunRow,
  replaceReviewRunFindings,
  requeueReviewRun,
} from '../db/queries/review-run-queries';
import type {
  AgentRuntimeSpec,
  PersistableFindingRow,
} from '../runtime/agent-runtime-spec';
import { classifyAgentFailure, toErrorMessage } from './retry-policy';

function now(): number {
  return Date.now();
}

function nextAttemptAt(baseMs: number, attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return now() + baseMs * 2 ** exponent;
}

export interface SessionResult {
  sessionId: string;
  rawOutput: string;
}

export interface ReviewRunPersistenceService {
  persistSucceeded(
    run: QueuedReviewRunRow,
    session: SessionResult,
    findings: PersistableFindingRow[],
  ): void;
  persistFailureOrRetry(run: QueuedReviewRunRow, error: unknown): void;
  persistMissingRuntimeSpec(run: QueuedReviewRunRow, message: string): void;
}

export function createReviewRunPersistenceService(options: {
  db: Database;
  retryBackoffMs: number;
}): ReviewRunPersistenceService {
  const { db, retryBackoffMs } = options;

  return {
    persistSucceeded(run, session, findings) {
      replaceReviewRunFindings(db, run.id, findings);

      markReviewRunSucceeded(
        db,
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
      appendEvent(db, {
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
    },

    persistFailureOrRetry(run, error) {
      const classification = classifyAgentFailure(error);
      const message = toErrorMessage(error);

      if (classification.retryable && run.attempt < run.max_attempts) {
        requeueReviewRun(
          db,
          run.id,
          nextAttemptAt(retryBackoffMs, run.attempt),
          classification.errorCode,
          message,
        );
        appendEvent(db, {
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
    },

    persistMissingRuntimeSpec(run, message) {
      markReviewRunFailed(
        db,
        run.id,
        'AGENT_NOT_REGISTERED',
        message,
        'failed_terminal',
        JSON.stringify({ reason: 'missing-runtime-spec' }),
      );
    },
  };
}

export function buildFindingsFromParsedOutput(
  spec: AgentRuntimeSpec,
  runtimeRun: {
    id: string;
    repo_id: string;
    trigger_event_id: string;
    trigger_id: 'commit' | 'pr' | 'manual';
    scope: 'commit-diff' | 'workspace-diff' | 'repo' | 'pr';
    path: string;
    default_branch: string;
  },
  reviewRunId: string,
  rawOutput: string,
): PersistableFindingRow[] {
  const parsed = spec.parseOutput(rawOutput);
  return spec.onSuccess({
    run: runtimeRun,
    reviewRunId,
    output: parsed,
  });
}
