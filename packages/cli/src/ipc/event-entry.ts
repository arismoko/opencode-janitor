import type { EventRow } from '../db/models';
import type { EventRowWithSession } from '../db/queries/event-queries';
import type { EventJournalEntry } from './protocol';

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function toEventEntry(
  row: EventRow | EventRowWithSession,
  sessionId?: string | null,
): EventJournalEntry {
  const payload = parsePayload(row.payload_json);
  const resolvedSessionId =
    sessionId ??
    ('session_id' in row
      ? row.session_id
      : typeof payload.sessionId === 'string'
        ? payload.sessionId
        : null);

  return {
    eventId: row.seq,
    ts: row.ts,
    level: row.level,
    topic: row.event_type,
    repoId: row.repo_id,
    triggerEventId: row.trigger_event_id,
    reviewRunId: row.review_run_id,
    sessionId: resolvedSessionId,
    message: row.message,
    payload,
  };
}
