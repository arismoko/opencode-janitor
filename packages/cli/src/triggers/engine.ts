import type { Database } from 'bun:sqlite';
import { TRIGGER_IDS, type TriggerId } from '@opencode-janitor/shared';
import type { z } from 'zod';
import type { CliConfig } from '../config/schema';
import { appendEvent } from '../db/queries/event-queries';
import { listRepos } from '../db/queries/repo-queries';
import { insertTriggerEvent } from '../db/queries/trigger-event-queries';
import { planReviewRunsForEvent } from '../runtime/planner';
import { TRIGGER_MODULES } from './modules';
import { createTriggerStateStore } from './state-store';

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

  for (const repo of repos) {
    for (const triggerId of TRIGGER_IDS) {
      if (triggerId === 'manual') {
        continue;
      }

      const module = modules[triggerId] as TriggerModule | undefined;
      const triggerConfig = options.config.triggers[
        triggerId
      ] as unknown as Record<string, unknown>;
      if (!module?.probe || !triggerConfig?.enabled) {
        continue;
      }

      try {
        const state = store.load(repo.id, triggerId, module.stateSchema);
        const result = await module.probe({
          repoPath: repo.path,
          state: state as Record<string, unknown>,
          config: triggerConfig,
        });

        const nextCheckAt =
          typeof result.nextState === 'object' &&
          result.nextState !== null &&
          'nextCheckAt' in result.nextState
            ? Number((result.nextState as Record<string, unknown>).nextCheckAt)
            : null;
        store.save(repo.id, triggerId, result.nextState, nextCheckAt);

        for (const emission of result.emissions) {
          const payloadObject = emission.payload as Record<string, unknown>;
          const subject = module.buildSubject(payloadObject);
          const inserted = insertTriggerEvent(options.db, {
            repoId: repo.id,
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
          repoId: repo.id,
          message: `Trigger probe failed for ${triggerId}: ${error instanceof Error ? error.message : String(error)}`,
          payload: { triggerId },
        });
      }
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
