import type { Database } from 'bun:sqlite';
import { makeId } from '../../utils/ids';
import { nowMs } from '../../utils/time';
import type { ReviewRunRow } from '../models';

export interface NewReviewRun {
  repoId: string;
  triggerEventId: string;
  agent: string;
  scope: string;
  scopeInputJson?: string;
  priority?: number;
  maxAttempts?: number;
}

export interface QueuedReviewRunRow {
  id: string;
  repo_id: string;
  trigger_event_id: string;
  agent: string;
  scope: string;
  scope_input_json: string;
  attempt: number;
  max_attempts: number;
  next_attempt_at: number;
  queued_at: number;
  path: string;
  default_branch: string;
  trigger_id: 'commit' | 'pr' | 'manual';
  subject: string;
  payload_json: string;
}

export function enqueueReviewRun(
  db: Database,
  run: NewReviewRun,
): { inserted: boolean; runId: string } {
  const existing = db
    .query(
      `
        SELECT id
        FROM review_runs
        WHERE trigger_event_id = ? AND agent = ?
        LIMIT 1
      `,
    )
    .get(run.triggerEventId, run.agent) as { id: string } | null;

  if (existing?.id) {
    return { inserted: false, runId: existing.id };
  }

  const runId = makeId('rrn');
  const now = nowMs();
  db.query(
    `
      INSERT INTO review_runs (
        id, repo_id, trigger_event_id, agent, scope, scope_input_json,
        status, priority, attempt, max_attempts, next_attempt_at, queued_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?)
    `,
  ).run(
    runId,
    run.repoId,
    run.triggerEventId,
    run.agent,
    run.scope,
    run.scopeInputJson ?? '{}',
    run.priority ?? 100,
    run.maxAttempts ?? 3,
    now,
    now,
  );

  return { inserted: true, runId };
}

export function claimNextQueuedReviewRun(
  db: Database,
  perRepoConcurrency: number,
): QueuedReviewRunRow | null {
  return db.transaction(() => {
    const now = nowMs();

    const row = db
      .query(
        `
          SELECT
            rr.id,
            rr.repo_id,
            rr.trigger_event_id,
            rr.agent,
            rr.scope,
            rr.scope_input_json,
            rr.attempt,
            rr.max_attempts,
            rr.next_attempt_at,
            rr.queued_at,
            r.path,
            r.default_branch,
            te.trigger_id,
            te.subject,
            te.payload_json
          FROM review_runs rr
          JOIN repos r ON r.id = rr.repo_id
          JOIN trigger_events te ON te.id = rr.trigger_event_id
          WHERE rr.status = 'queued'
            AND rr.next_attempt_at <= ?
            AND r.enabled = 1
            AND r.paused = 0
            AND (
              SELECT COUNT(*)
              FROM review_runs running
              WHERE running.repo_id = rr.repo_id
                AND running.status = 'running'
            ) < ?
          ORDER BY rr.priority ASC, rr.queued_at ASC
          LIMIT 1
        `,
      )
      .get(now, perRepoConcurrency) as QueuedReviewRunRow | null;

    if (!row) {
      return null;
    }

    db.query(
      `
        UPDATE review_runs
        SET status = 'running', started_at = ?, next_attempt_at = 0, attempt = attempt + 1
        WHERE id = ?
      `,
    ).run(now, row.id);

    return {
      ...row,
      attempt: row.attempt + 1,
    };
  })();
}

export function markReviewRunSucceeded(
  db: Database,
  runId: string,
  findingsCount: number,
  rawOutput: string,
  outcome: string,
  summaryJson: string,
): void {
  db.query(
    `
      UPDATE review_runs
      SET
        status = 'succeeded',
        findings_count = ?,
        raw_output = ?,
        outcome = ?,
        summary_json = ?,
        finished_at = ?
      WHERE id = ?
    `,
  ).run(findingsCount, rawOutput, outcome, summaryJson, nowMs(), runId);
}

export function markReviewRunFailed(
  db: Database,
  runId: string,
  errorCode: string,
  errorMessage: string,
  outcome: string,
  summaryJson: string,
): void {
  db.query(
    `
      UPDATE review_runs
      SET
        status = 'failed',
        error_code = ?,
        error_message = ?,
        outcome = ?,
        summary_json = ?,
        finished_at = ?
      WHERE id = ?
    `,
  ).run(errorCode, errorMessage, outcome, summaryJson, nowMs(), runId);
}

export function requeueReviewRun(
  db: Database,
  runId: string,
  nextAttemptAt: number,
  errorCode: string,
  errorMessage: string,
): void {
  db.query(
    `
      UPDATE review_runs
      SET
        status = 'queued',
        started_at = NULL,
        error_code = ?,
        error_message = ?,
        next_attempt_at = ?
      WHERE id = ?
    `,
  ).run(errorCode, errorMessage, nextAttemptAt, runId);
}

export function getReviewRunBySessionId(
  db: Database,
  sessionId: string,
): ReviewRunRow | null {
  return (
    (db
      .query('SELECT * FROM review_runs WHERE session_id = ? LIMIT 1')
      .get(sessionId) as ReviewRunRow | null) ?? null
  );
}
