import type { Database } from 'bun:sqlite';
import type { TriggerId } from '@opencode-janitor/shared';
import type { z } from 'zod';
import {
  getTriggerState,
  listRepoIdsWithState,
  listTriggerStatesDue,
  upsertTriggerState,
} from '../db/queries/trigger-state-queries';

export interface TriggerStateStore {
  load<TState>(
    repoId: string,
    triggerId: TriggerId,
    schema: z.ZodType<TState>,
  ): TState;
  save(
    repoId: string,
    triggerId: TriggerId,
    state: unknown,
    nextCheckAt?: number | null,
  ): void;
  listDue(triggerId: TriggerId, now: number, limit: number): string[];
  /** Return repo IDs that have any trigger_states row for this triggerId. */
  listRepoIdsWithState(triggerId: TriggerId): string[];
}

export function createTriggerStateStore(db: Database): TriggerStateStore {
  return {
    load(repoId, triggerId, schema) {
      const row = getTriggerState(db, repoId, triggerId);
      if (!row) {
        return schema.parse({});
      }

      let parsedJson: unknown = {};
      try {
        parsedJson = JSON.parse(row.state_json);
      } catch {
        parsedJson = {};
      }
      return schema.parse(parsedJson);
    },

    save(repoId, triggerId, state, nextCheckAt) {
      upsertTriggerState(db, {
        repoId,
        triggerId,
        stateJson: JSON.stringify(state),
        nextCheckAt,
        lastCheckedAt: Date.now(),
      });
    },

    listDue(triggerId, now, limit) {
      return listTriggerStatesDue(db, triggerId, now, limit).map(
        (row) => row.repo_id,
      );
    },

    listRepoIdsWithState(triggerId) {
      return listRepoIdsWithState(db, triggerId);
    },
  };
}
