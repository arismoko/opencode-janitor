import type { Database } from 'bun:sqlite';
import { nowMs } from '../../utils/time';
import type { EventRow } from '../models';

export interface NewEvent {
  eventType: string;
  message: string;
  level?: EventRow['level'];
  repoId?: string;
  jobId?: string;
  agentRunId?: string;
  payload?: Record<string, unknown>;
}

export interface EventFilterParams {
  repoId?: string;
  jobId?: string;
  agentRunId?: string;
  topic?: string;
  sessionId?: string;
}

export interface EventRowWithSession extends EventRow {
  session_id: string | null;
}

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

export function listEvents(db: Database, limit: number): EventRow[] {
  return db
    .query('SELECT * FROM event_journal ORDER BY seq DESC LIMIT ?')
    .all(limit) as EventRow[];
}

export function getLatestEventSeq(db: Database): number {
  const row = db
    .query('SELECT COALESCE(MAX(seq), 0) AS seq FROM event_journal')
    .get() as { seq: number };
  return row.seq;
}

export function listEventsAfterSeq(
  db: Database,
  afterSeq: number,
  limit: number,
): EventRow[] {
  return db
    .query('SELECT * FROM event_journal WHERE seq > ? ORDER BY seq ASC LIMIT ?')
    .all(afterSeq, limit) as EventRow[];
}

export function listEventsAfterSeqFiltered(
  db: Database,
  afterSeq: number,
  limit: number,
  filters?: EventFilterParams,
): EventRowWithSession[] {
  const conditions: string[] = ['e.seq > ?'];
  const params: (string | number)[] = [afterSeq];

  if (filters?.repoId) {
    conditions.push('e.repo_id = ?');
    params.push(filters.repoId);
  }
  if (filters?.jobId) {
    conditions.push('e.job_id = ?');
    params.push(filters.jobId);
  }
  if (filters?.agentRunId) {
    conditions.push('e.agent_run_id = ?');
    params.push(filters.agentRunId);
  }
  if (filters?.topic) {
    conditions.push('e.event_type = ?');
    params.push(filters.topic);
  }
  if (filters?.sessionId) {
    conditions.push('ar.session_id = ?');
    params.push(filters.sessionId);
  }

  params.push(limit);

  const sql = `
    SELECT e.*, ar.session_id
    FROM event_journal e
    LEFT JOIN agent_runs ar ON ar.id = e.agent_run_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.seq ASC
    LIMIT ?
  `;

  return db.query(sql).all(...params) as EventRowWithSession[];
}
