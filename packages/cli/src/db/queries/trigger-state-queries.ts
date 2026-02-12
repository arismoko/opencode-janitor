import type { Database } from 'bun:sqlite';
import { nowMs } from '../../utils/time';
import type { TriggerStateRow } from '../models';

export function getTriggerState(
  db: Database,
  repoId: string,
  triggerId: TriggerStateRow['trigger_id'],
): TriggerStateRow | null {
  return (
    (db
      .query(
        'SELECT * FROM trigger_states WHERE repo_id = ? AND trigger_id = ? LIMIT 1',
      )
      .get(repoId, triggerId) as TriggerStateRow | null) ?? null
  );
}

export function upsertTriggerState(
  db: Database,
  input: {
    repoId: string;
    triggerId: TriggerStateRow['trigger_id'];
    stateJson: string;
    nextCheckAt?: number | null;
    lastCheckedAt?: number | null;
  },
): void {
  db.query(
    `
      INSERT INTO trigger_states (
        repo_id, trigger_id, state_json, next_check_at, last_checked_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo_id, trigger_id)
      DO UPDATE SET
        state_json = excluded.state_json,
        next_check_at = excluded.next_check_at,
        last_checked_at = excluded.last_checked_at,
        updated_at = excluded.updated_at
    `,
  ).run(
    input.repoId,
    input.triggerId,
    input.stateJson,
    input.nextCheckAt ?? null,
    input.lastCheckedAt ?? null,
    nowMs(),
  );
}

/**
 * Return all repo IDs that have a trigger_states row for the given triggerId.
 * Used to distinguish "bootstrap" repos (no row) from repos with scheduled state.
 */
export function listRepoIdsWithState(
  db: Database,
  triggerId: TriggerStateRow['trigger_id'],
): string[] {
  return (
    db
      .query('SELECT repo_id FROM trigger_states WHERE trigger_id = ?')
      .all(triggerId) as Array<{ repo_id: string }>
  ).map((row) => row.repo_id);
}

export function listTriggerStatesDue(
  db: Database,
  triggerId: TriggerStateRow['trigger_id'],
  now: number,
  limit: number,
): TriggerStateRow[] {
  return db
    .query(
      `
        SELECT *
        FROM trigger_states
        WHERE trigger_id = ?
          AND (next_check_at IS NULL OR next_check_at <= ?)
        ORDER BY COALESCE(next_check_at, 0) ASC
        LIMIT ?
      `,
    )
    .all(triggerId, now, limit) as TriggerStateRow[];
}
