import type { Database } from 'bun:sqlite';
import { TRIGGER_IDS, type TriggerId } from '@opencode-janitor/shared';
import type { z } from 'zod';
import type { CliConfig } from '../config/schema';
import { appendEvent } from '../db/queries/event-queries';
import { listRepos } from '../db/queries/repo-queries';
import { insertTriggerEvent } from '../db/queries/trigger-event-queries';
import { planReviewRunsForEvent } from '../runtime/planner';
import { TRIGGER_MODULES } from './modules';
import { createTriggerStateStore, type TriggerStateStore } from './state-store';

const DEFAULT_TICK_MS = 1000;

export interface TriggerEngineHandle {
  stop(): void;
}

export interface TriggerEngineOptions {
  db: Database;
  config: CliConfig;
  maxAttempts: number;
  onJobEnqueued?: () => void;
}

type TriggerModule = {
  stateSchema: z.ZodTypeAny;
  probe?: (input: {
    repoPath: string;
    state: Record<string, unknown>;
    config: Record<string, unknown>;
  }) => Promise<{
    nextState: Record<string, unknown>;
    emissions: Array<{
      eventKey: string;
      payload: Record<string, unknown>;
      detectedAt: number;
    }>;
  }>;
  buildSubject: (payload: Record<string, unknown>) => string;
};

interface TickOptions extends TriggerEngineOptions {
  modules?: Partial<Record<TriggerId, TriggerModule>>;
}

/**
 * Determine which (repo, trigger) pairs are due for probing.
 *
 * A repo is due for a given trigger if:
 *   1. It has no trigger_states row at all (bootstrap / first run), OR
 *   2. Its existing row has next_check_at IS NULL, OR
 *   3. Its existing row has next_check_at <= now.
 *
 * listDue covers cases 2+3 (existing rows). Case 1 (missing rows) is handled
 * by comparing against listRepoIdsWithState to find repos with no row.
 */
function collectDuePairs(
  store: TriggerStateStore,
  repos: Array<{ id: string; path: string }>,
  modules: Partial<Record<TriggerId, TriggerModule>>,
  config: CliConfig,
): Array<{ repoId: string; repoPath: string; triggerId: TriggerId }> {
  const pairs: Array<{
    repoId: string;
    repoPath: string;
    triggerId: TriggerId;
  }> = [];
  const nowMs = Date.now();

  for (const triggerId of TRIGGER_IDS) {
    if (triggerId === 'manual') continue;

    const module = modules[triggerId] as TriggerModule | undefined;
    const triggerConfig = config.triggers[triggerId] as unknown as Record<
      string,
      unknown
    >;
    if (!module?.probe || !triggerConfig?.enabled) continue;

    // Repos with existing state rows that are due (next_check_at IS NULL or <= now).
    const dueRepoIds = store.listDue(triggerId, nowMs, repos.length);
    const dueSet = new Set(dueRepoIds);

    // Repos that have ANY state row for this trigger (used to detect bootstrap).
    const hasStateSet = new Set(store.listRepoIdsWithState(triggerId));

    for (const repo of repos) {
      // Due if: already in the due set, OR no state row exists (bootstrap).
      if (dueSet.has(repo.id) || !hasStateSet.has(repo.id)) {
        pairs.push({ repoId: repo.id, repoPath: repo.path, triggerId });
      }
    }
  }

  return pairs;
}

export async function runTriggerEngineTick(
  options: TickOptions,
): Promise<void> {
  const modules = (options.modules ?? TRIGGER_MODULES) as Partial<
    Record<TriggerId, TriggerModule>
  >;
  const store = createTriggerStateStore(options.db);
  const repos = listRepos(options.db).filter(
    (repo) => repo.enabled === 1 && repo.paused === 0,
  );

  const duePairs = collectDuePairs(store, repos, modules, options.config);

  for (const { repoId, repoPath, triggerId } of duePairs) {
    const module = modules[triggerId] as TriggerModule;
    const triggerConfig = options.config.triggers[
      triggerId
    ] as unknown as Record<string, unknown>;

    if (!module.probe) continue;

    try {
      const state = store.load(repoId, triggerId, module.stateSchema);
      const result = await module.probe({
        repoPath,
        state: state as Record<string, unknown>,
        config: triggerConfig,
      });

      const nextCheckAt =
        typeof result.nextState === 'object' &&
        result.nextState !== null &&
        'nextCheckAt' in result.nextState
          ? Number((result.nextState as Record<string, unknown>).nextCheckAt)
          : null;
      store.save(repoId, triggerId, result.nextState, nextCheckAt);

      for (const emission of result.emissions) {
        const payloadObject = emission.payload as Record<string, unknown>;
        const subject = module.buildSubject(payloadObject);
        const inserted = insertTriggerEvent(options.db, {
          repoId,
          triggerId,
          eventKey: emission.eventKey,
          subject,
          payloadJson: JSON.stringify(payloadObject),
          source: 'poll',
          detectedAt: emission.detectedAt,
        });

        if (!inserted.inserted) {
          continue;
        }

        const planned = planReviewRunsForEvent(
          options.db,
          options.config,
          inserted.eventId,
        );
        if (planned.planned > 0) {
          options.onJobEnqueued?.();
        }
      }
    } catch (error) {
      appendEvent(options.db, {
        eventType: 'trigger.engine.error',
        level: 'warn',
        repoId,
        message: `Trigger probe failed for ${triggerId}: ${error instanceof Error ? error.message : String(error)}`,
        payload: { triggerId },
      });
    }
  }
}

export function startTriggerEngine(
  options: TriggerEngineOptions,
): TriggerEngineHandle {
  let running = true;
  let tickBusy = false;

  const run = async () => {
    if (!running || tickBusy) {
      return;
    }
    tickBusy = true;
    try {
      await runTriggerEngineTick(options);
    } finally {
      tickBusy = false;
    }
  };

  const timer = setInterval(() => {
    run().catch(() => {
      // Errors are logged per-trigger in runTriggerEngineTick.
    });
  }, DEFAULT_TICK_MS);

  run().catch(() => {
    // Errors are logged per-trigger in runTriggerEngineTick.
  });

  return {
    stop() {
      running = false;
      clearInterval(timer);
    },
  };
}
