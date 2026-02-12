import type { Database } from 'bun:sqlite';
import { nowMs } from '../../utils/time';
import type { EventRow } from '../models';

export interface NewEvent {
  eventType: string;
  message: string;
  level?: EventRow['level'];
  repoId?: string;
  triggerEventId?: string;
  reviewRunId?: string;
  payload?: Record<string, unknown>;
}

export interface EventFilterParams {
  repoId?: string;
  triggerEventId?: string;
  reviewRunId?: string;
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
        ts, level, event_type, repo_id, trigger_event_id, review_run_id, message, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    nowMs(),
    event.level ?? 'info',
    event.eventType,
    event.repoId ?? null,
    event.triggerEventId ?? null,
    event.reviewRunId ?? null,
    event.message,
    JSON.stringify(payload),
  );
}

export function listEvents(db: Database, limit: number): EventRow[] {
  return db
    .query('SELECT * FROM event_journal ORDER BY seq DESC LIMIT ?')
    .all(limit) as EventRow[];
}

export function clearEvents(db: Database): { deleted: number } {
  const result = db.query('DELETE FROM event_journal').run() as {
    changes?: number;
  };
  return { deleted: result.changes ?? 0 };
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
  if (filters?.triggerEventId) {
    conditions.push('e.trigger_event_id = ?');
    params.push(filters.triggerEventId);
  }
  if (filters?.reviewRunId) {
    conditions.push('e.review_run_id = ?');
    params.push(filters.reviewRunId);
  }
  if (filters?.topic) {
    conditions.push('e.event_type = ?');
    params.push(filters.topic);
  }
  if (filters?.sessionId) {
    conditions.push('rr.session_id = ?');
    params.push(filters.sessionId);
  }

  params.push(limit);

  const sql = `
    SELECT e.*, rr.session_id
    FROM event_journal e
    LEFT JOIN review_runs rr ON rr.id = e.review_run_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.seq ASC
    LIMIT ?
  `;

  return db.query(sql).all(...params) as EventRowWithSession[];
}
