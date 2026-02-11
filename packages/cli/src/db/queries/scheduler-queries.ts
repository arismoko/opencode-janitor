import type { Database } from 'bun:sqlite';
import { makeId } from '../../utils/ids';
import { nowMs } from '../../utils/time';
import type { AgentRunSummary, FindingRow, QueuedJobRow } from '../models';

export function claimNextQueuedJob(db: Database): QueuedJobRow | null {
  return claimNextQueuedJobWithRepoLimit(db, 1);
}

export function claimNextQueuedJobWithRepoLimit(
  db: Database,
  perRepoConcurrency: number,
): QueuedJobRow | null {
  return db.transaction(() => {
    const now = nowMs();

    const job = db
      .query(
        `
        SELECT j.id, j.repo_id, j.trigger_id, j.dedupe_key, j.attempt, j.max_attempts, j.next_attempt_at, j.queued_at,
               r.path, r.default_branch,
               COALESCE(t.kind, 'manual') AS kind,
               COALESCE(t.subject_key, '') AS subject_key,
               COALESCE(t.payload_json, '{}') AS payload_json
        FROM review_jobs j
        JOIN repos r ON r.id = j.repo_id
        LEFT JOIN review_triggers t ON t.id = j.trigger_id
        WHERE j.status = 'queued'
          AND j.cancel_requested = 0
          AND j.next_attempt_at <= ?
          AND r.enabled = 1
          AND r.paused = 0
          AND (
            SELECT COUNT(*)
            FROM review_jobs running
            WHERE running.repo_id = j.repo_id
              AND running.status = 'running'
          ) < ?
        ORDER BY j.priority ASC, j.queued_at ASC
        LIMIT 1
        `,
      )
      .get(now, perRepoConcurrency) as QueuedJobRow | null;

    if (!job) return null;

    db.query(
      `UPDATE review_jobs SET status = 'running', started_at = ?, next_attempt_at = 0, attempt = attempt + 1 WHERE id = ?`,
    ).run(now, job.id);

    return { ...job, attempt: job.attempt + 1 } as QueuedJobRow;
  })();
}

export function markJobSucceeded(db: Database, jobId: string): void {
  db.query(
    `UPDATE review_jobs SET status = 'succeeded', finished_at = ? WHERE id = ?`,
  ).run(nowMs(), jobId);
}

export function markJobFailed(
  db: Database,
  jobId: string,
  errorCode: string,
  errorMessage: string,
  errorType: 'terminal' | 'transient' | 'cancelled' | 'unknown' = 'unknown',
): void {
  db.query(
    `UPDATE review_jobs SET status = 'failed', finished_at = ?, error_code = ?, error_message = ?, last_error_type = ? WHERE id = ?`,
  ).run(nowMs(), errorCode, errorMessage, errorType, jobId);
}

export function requeueJob(
  db: Database,
  jobId: string,
  errorCode: string,
  errorMessage: string,
  nextAttemptAt: number,
  errorType: 'transient' | 'cancelled' | 'unknown' = 'transient',
): void {
  db.query(
    `
      UPDATE review_jobs
      SET
        status = 'queued',
        started_at = NULL,
        error_code = ?,
        error_message = ?,
        next_attempt_at = ?,
        last_error_type = ?
      WHERE id = ?
    `,
  ).run(errorCode, errorMessage, nextAttemptAt, errorType, jobId);
}

export function recoverRunningJobs(db: Database): number {
  const result = db
    .query(
      `
      UPDATE review_jobs
      SET status = 'queued', started_at = NULL
      WHERE status = 'running'
    `,
    )
    .run() as { changes?: number };

  return result.changes ?? 0;
}

export function recoverRunningAgentRuns(db: Database): number {
  const result = db
    .query(
      `
      UPDATE agent_runs
      SET
        status = 'queued',
        session_id = NULL,
        outcome = NULL,
        summary_json = NULL,
        started_at = NULL,
        finished_at = NULL,
        error_code = NULL,
        error_message = NULL
      WHERE status = 'running'
    `,
    )
    .run() as { changes?: number };

  return result.changes ?? 0;
}

export function createAgentRun(
  db: Database,
  opts: {
    jobId: string;
    agent: string;
    modelId?: string;
    variant?: string;
  },
): string {
  const existing = db
    .query('SELECT id FROM agent_runs WHERE job_id = ? AND agent = ? LIMIT 1')
    .get(opts.jobId, opts.agent) as { id: string } | null;

  if (existing?.id) {
    db.query(
      `
        UPDATE agent_runs
        SET
          status = 'queued',
          model_id = ?,
          variant = ?,
          session_id = NULL,
          outcome = NULL,
          summary_json = NULL,
          findings_count = 0,
          raw_output = NULL,
          started_at = NULL,
          finished_at = NULL,
          error_code = NULL,
          error_message = NULL
        WHERE id = ?
      `,
    ).run(opts.modelId ?? null, opts.variant ?? null, existing.id);

    db.query('DELETE FROM findings WHERE agent_run_id = ?').run(existing.id);
    return existing.id;
  }

  const id = makeId('arn');
  db.query(
    `
      INSERT INTO agent_runs (id, job_id, agent, status, model_id, variant, findings_count)
      VALUES (?, ?, ?, 'queued', ?, ?, 0)
    `,
  ).run(id, opts.jobId, opts.agent, opts.modelId ?? null, opts.variant ?? null);
  return id;
}

export function markAgentRunRunning(
  db: Database,
  runId: string,
  sessionId?: string,
): void {
  db.query(
    `UPDATE agent_runs SET status = 'running', session_id = ?, outcome = NULL, summary_json = NULL, started_at = ? WHERE id = ?`,
  ).run(sessionId ?? null, nowMs(), runId);
}

export function markAgentRunSucceeded(
  db: Database,
  runId: string,
  findingsCount: number,
  rawOutput: string,
  summary: AgentRunSummary,
): void {
  db.query(
    `UPDATE agent_runs SET status = 'succeeded', outcome = ?, summary_json = ?, findings_count = ?, raw_output = ?, finished_at = ? WHERE id = ?`,
  ).run(
    summary.outcome,
    JSON.stringify(summary),
    findingsCount,
    rawOutput,
    nowMs(),
    runId,
  );
}

export function markAgentRunFailed(
  db: Database,
  runId: string,
  errorCode: string,
  errorMessage: string,
  summary: AgentRunSummary,
): void {
  db.query(
    `UPDATE agent_runs SET status = 'failed', outcome = ?, summary_json = ?, error_code = ?, error_message = ?, finished_at = ? WHERE id = ?`,
  ).run(
    summary.outcome,
    JSON.stringify(summary),
    errorCode,
    errorMessage,
    nowMs(),
    runId,
  );
}

export function insertFindingRows(
  db: Database,
  rows: Omit<FindingRow, 'id' | 'created_at'>[],
): void {
  const agentRunIds = [...new Set(rows.map((row) => row.agent_run_id))];
  const reviewRunIds = [
    ...new Set(
      rows
        .map((row) => row.review_run_id)
        .filter((value): value is string => typeof value === 'string'),
    ),
  ];
  if (agentRunIds.length === 0 && reviewRunIds.length === 0) return;

  const now = nowMs();
  const deleteStmt = db.query('DELETE FROM findings WHERE agent_run_id = ?');
  const deleteReviewRunStmt = db.query(
    'DELETE FROM findings WHERE review_run_id = ?',
  );
  const stmt = db.query(
    `
    INSERT INTO findings (id, repo_id, job_id, agent_run_id, review_run_id, agent, severity, domain, location, evidence, prescription, fingerprint, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  db.transaction(() => {
    for (const agentRunId of agentRunIds) {
      deleteStmt.run(agentRunId);
    }
    for (const reviewRunId of reviewRunIds) {
      deleteReviewRunStmt.run(reviewRunId);
    }

    for (const row of rows) {
      const id = makeId('fnd');
      stmt.run(
        id,
        row.repo_id,
        row.job_id,
        row.agent_run_id,
        row.review_run_id ?? null,
        row.agent,
        row.severity,
        row.domain,
        row.location,
        row.evidence,
        row.prescription,
        row.fingerprint,
        now,
      );
    }
  })();
}

export function deleteAgentRun(db: Database, agentRunId: string): boolean {
  return db.transaction(() => {
    db.query('DELETE FROM findings WHERE agent_run_id = ?').run(agentRunId);
    const result = db
      .query(
        `
        DELETE FROM agent_runs
        WHERE id = ?
          AND status IN ('queued', 'succeeded', 'failed', 'skipped')
        `,
      )
      .run(agentRunId) as { changes?: number };
    return (result.changes ?? 0) > 0;
  })();
}

export interface AgentRunContext {
  agentRunId: string;
  jobId: string;
  repoId: string;
  agent: string;
}

export function findAgentRunContextBySessionId(
  db: Database,
  sessionId: string,
): AgentRunContext | null {
  const row = db
    .query(
      `
      SELECT ar.id AS agent_run_id, ar.job_id, j.repo_id, ar.agent
      FROM agent_runs ar
      JOIN review_jobs j ON j.id = ar.job_id
      WHERE ar.session_id = ?
        AND ar.status = 'running'
      LIMIT 1
      `,
    )
    .get(sessionId) as {
    agent_run_id: string;
    job_id: string;
    repo_id: string;
    agent: string;
  } | null;

  if (!row) return null;

  return {
    agentRunId: row.agent_run_id,
    jobId: row.job_id,
    repoId: row.repo_id,
    agent: row.agent,
  };
}
