import type { Database } from 'bun:sqlite';
import { makeId } from '../../utils/ids';
import type { TriggerEventRow } from '../models';

export interface InsertTriggerEventInput {
  repoId: string;
  triggerId: TriggerEventRow['trigger_id'];
  eventKey: string;
  subject: string;
  payloadJson: string;
  source: TriggerEventRow['source'];
  detectedAt: number;
}

export function insertTriggerEvent(
  db: Database,
  input: InsertTriggerEventInput,
): { inserted: boolean; eventId: string } {
  const existing = db
    .query(
      `
        SELECT id
        FROM trigger_events
        WHERE repo_id = ? AND trigger_id = ? AND event_key = ?
        LIMIT 1
      `,
    )
    .get(input.repoId, input.triggerId, input.eventKey) as {
    id: string;
  } | null;

  if (existing?.id) {
    return { inserted: false, eventId: existing.id };
  }

  const eventId = makeId('tev');
  db.query(
    `
      INSERT INTO trigger_events (
        id, repo_id, trigger_id, event_key, subject, payload_json, source, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    eventId,
    input.repoId,
    input.triggerId,
    input.eventKey,
    input.subject,
    input.payloadJson,
    input.source,
    input.detectedAt,
  );

  return { inserted: true, eventId };
}

export function getTriggerEventById(
  db: Database,
  eventId: string,
): TriggerEventRow | null {
  return (
    (db
      .query('SELECT * FROM trigger_events WHERE id = ? LIMIT 1')
      .get(eventId) as TriggerEventRow | null) ?? null
  );
}

export function listTriggerEventsWithoutRuns(
  db: Database,
  limit: number,
): TriggerEventRow[] {
  return db
    .query(
      `
        SELECT te.*
        FROM trigger_events te
        WHERE NOT EXISTS (
          SELECT 1
          FROM review_runs rr
          WHERE rr.trigger_event_id = te.id
        )
        ORDER BY te.detected_at ASC
        LIMIT ?
      `,
    )
    .all(limit) as TriggerEventRow[];
}
