/**
 * Database query helpers.
 */
import type { Database } from 'bun:sqlite';
import { makeId } from '../utils/ids';
import { nowMs } from '../utils/time';
import type {
  AgentRunSummary,
  EventRow,
  FindingRow,
  QueuedJobRow,
  RepoRow,
} from './models';

export interface NewRepo {
  path: string;
  gitDir: string;
  defaultBranch: string;
}

export interface NewEvent {
  eventType: string;
  message: string;
  level?: EventRow['level'];
  repoId?: string;
  jobId?: string;
  agentRunId?: string;
  payload?: Record<string, unknown>;
}

export interface TriggerEnqueueInput {
  repoId: string;
  kind: 'commit' | 'pr' | 'manual';
  source: 'fswatch' | 'poll' | 'tool-hook' | 'cli' | 'recovery';
  subjectKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}

/** Add a tracked repository row. */
export function addRepo(db: Database, repo: NewRepo): RepoRow {
  const now = nowMs();
  const id = makeId('repo');

  db.query(
    `
      INSERT INTO repos (
        id, path, git_dir, default_branch, enabled, paused, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 0, ?, ?)
    `,
  ).run(id, repo.path, repo.gitDir, repo.defaultBranch, now, now);

  return db.query('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow;
}

/** Remove a repository by id or path. Returns removed row or null. */
export function removeRepoByIdOrPath(
  db: Database,
  idOrPath: string,
): RepoRow | null {
  const row = db
    .query('SELECT * FROM repos WHERE id = ? OR path = ?')
    .get(idOrPath, idOrPath) as RepoRow | null;

  if (!row) {
    return null;
  }

  db.query('DELETE FROM repos WHERE id = ?').run(row.id);
  return row;
}

/** List tracked repositories. */
export function listRepos(db: Database): RepoRow[] {
  return db
    .query('SELECT * FROM repos ORDER BY created_at DESC')
    .all() as RepoRow[];
}

/** Update repo signal fields (HEAD/PR markers). */
export function updateRepoSignals(
  db: Database,
  repoId: string,
  updates: { lastHeadSha?: string | null; lastPrKey?: string | null },
): void {
  const now = nowMs();
  db.query(
    `
      UPDATE repos
      SET
        last_head_sha = COALESCE(?, last_head_sha),
        last_pr_key = COALESCE(?, last_pr_key),
        updated_at = ?
      WHERE id = ?
    `,
  ).run(updates.lastHeadSha ?? null, updates.lastPrKey ?? null, now, repoId);
}

/**
 * Enqueue trigger + job transactionally.
 * Returns true when inserted, false when skipped as duplicate.
 */
export function enqueueTriggerAndJob(
  db: Database,
  input: TriggerEnqueueInput,
): boolean {
  const now = nowMs();
  const dedupeKey = `${input.repoId}:${input.kind}:${input.subjectKey}`;
  const triggerID = makeId('trg');
  const jobID = makeId('job');
  const maxAttempts = input.maxAttempts ?? 3;

  return db.transaction(() => {
    const triggerInsert = db
      .query(
        `
        INSERT OR IGNORE INTO review_triggers (
          id, repo_id, kind, source, subject_key, dedupe_key, payload_json, detected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        triggerID,
        input.repoId,
        input.kind,
        input.source,
        input.subjectKey,
        dedupeKey,
        JSON.stringify(input.payload),
        now,
      ) as { changes?: number };

    if (!triggerInsert.changes) {
      return false;
    }

    db.query(
      `
        INSERT OR IGNORE INTO review_jobs (
          id, repo_id, trigger_id, dedupe_key, status, priority,
          attempt, max_attempts, cancel_requested, queued_at, next_attempt_at
        ) VALUES (?, ?, ?, ?, 'queued', 100, 0, ?, 0, ?, ?)
      `,
    ).run(jobID, input.repoId, triggerID, dedupeKey, maxAttempts, now, now);

    return true;
  })();
}

/** Append an event to the event journal. */
export function appendEvent(db: Database, event: NewEvent): void {
  const payload = event.payload ?? {};

  db.query(
    `
      INSERT INTO event_journal (
        ts, level, event_type, repo_id, job_id, agent_run_id, message, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    nowMs(),
    event.level ?? 'info',
    event.eventType,
    event.repoId ?? null,
    event.jobId ?? null,
    event.agentRunId ?? null,
    event.message,
    JSON.stringify(payload),
  );
}

/** List recent events, newest first. */
export function listEvents(db: Database, limit: number): EventRow[] {
  return db
    .query('SELECT * FROM event_journal ORDER BY seq DESC LIMIT ?')
    .all(limit) as EventRow[];
}

/** List events after a cursor sequence, oldest first. */
export function listEventsAfterSeq(
  db: Database,
  afterSeq: number,
  limit: number,
): EventRow[] {
  return db
    .query('SELECT * FROM event_journal WHERE seq > ? ORDER BY seq ASC LIMIT ?')
    .all(afterSeq, limit) as EventRow[];
}

// ---------------------------------------------------------------------------
// Scheduler query helpers
// ---------------------------------------------------------------------------

/**
 * Transactionally claim the oldest queued job.
 * Sets status -> running, increments attempt, sets started_at.
 * Returns a joined row with repo + trigger context, or null if none available.
 */
export function claimNextQueuedJob(db: Database): QueuedJobRow | null {
  return claimNextQueuedJobWithRepoLimit(db, 1);
}

/**
 * Transactionally claim the oldest queued job while enforcing per-repo running cap.
 */
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

    // Return with updated attempt
    return { ...job, attempt: job.attempt + 1 } as QueuedJobRow;
  })();
}

/** Mark a job as succeeded. */
export function markJobSucceeded(db: Database, jobId: string): void {
  db.query(
    `UPDATE review_jobs SET status = 'succeeded', finished_at = ? WHERE id = ?`,
  ).run(nowMs(), jobId);
}

/** Mark a job as failed with error details. */
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

/** Requeue a running job with failure metadata for retry. */
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

/** Reset stale running jobs to queued on daemon startup. */
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

/** Reset running agent runs to queued on daemon startup recovery. */
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

/** Create an agent_runs row. Returns the new row ID. */
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

/** Mark an agent run as running with optional session ID. */
export function markAgentRunRunning(
  db: Database,
  runId: string,
  sessionId?: string,
): void {
  db.query(
    `UPDATE agent_runs SET status = 'running', session_id = ?, outcome = NULL, summary_json = NULL, started_at = ? WHERE id = ?`,
  ).run(sessionId ?? null, nowMs(), runId);
}

/** Mark an agent run as succeeded. */
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

/** Mark an agent run as failed. */
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

/** Insert multiple finding rows in a single transaction. */
export function insertFindingRows(
  db: Database,
  rows: Omit<FindingRow, 'id' | 'created_at'>[],
): void {
  const agentRunIds = [...new Set(rows.map((row) => row.agent_run_id))];
  if (agentRunIds.length === 0) return;

  const now = nowMs();
  const deleteStmt = db.query('DELETE FROM findings WHERE agent_run_id = ?');
  const stmt = db.query(
    `
    INSERT INTO findings (id, repo_id, job_id, agent_run_id, agent, severity, domain, location, evidence, prescription, fingerprint, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  db.transaction(() => {
    for (const agentRunId of agentRunIds) {
      deleteStmt.run(agentRunId);
    }

    for (const row of rows) {
      const id = makeId('fnd');
      stmt.run(
        id,
        row.repo_id,
        row.job_id,
        row.agent_run_id,
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

/** Find a repo by ID or absolute path. */
export function findRepoByIdOrPath(
  db: Database,
  idOrPath: string,
): RepoRow | null {
  return (
    (db
      .query('SELECT * FROM repos WHERE id = ? OR path = ?')
      .get(idOrPath, idOrPath) as RepoRow | null) ?? null
  );
}
