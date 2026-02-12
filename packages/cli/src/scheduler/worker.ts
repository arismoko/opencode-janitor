import type { Database } from 'bun:sqlite';
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { CliConfig } from '../config/schema';
import { claimNextQueuedReviewRun } from '../db/queries/review-run-queries';
import { abortSession } from '../reviews/runner';
import type { AgentRuntimeRegistry } from '../runtime/agent-runtime-registry';
import type { SessionCompletionBus } from '../runtime/session-completion-bus';
import {
  createReviewRunPersistenceService,
  type ReviewRunPersistenceService,
} from './review-run-persistence';
import {
  type ActiveSession,
  createReviewRunProcessor,
  type ReviewRunProcessor,
} from './review-run-processor';

const DEFAULT_STOP_TIMEOUT_MS = 10_000;
const FALLBACK_HEARTBEAT_MS = 1000;

export interface SchedulerDeps {
  db: Database;
  client: OpencodeClient;
  config: CliConfig;
  registry: AgentRuntimeRegistry;
  completionBus: SessionCompletionBus;
}

export interface SchedulerHandle {
  wake(): void;
  stop(options?: { timeoutMs?: number; cancelMessage?: string }): Promise<void>;
}

function createSignal() {
  let resolver: (() => void) | null = null;
  return {
    notify() {
      resolver?.();
      resolver = null;
    },
    wait(timeoutMs: number) {
      return new Promise<void>((resolve) => {
        resolver = resolve;
        setTimeout(() => {
          if (resolver === resolve) {
            resolver = null;
            resolve();
          }
        }, timeoutMs);
      });
    },
  };
}

export function startScheduler(deps: SchedulerDeps): SchedulerHandle {
  const persistence: ReviewRunPersistenceService =
    createReviewRunPersistenceService({
      db: deps.db,
      retryBackoffMs: deps.config.scheduler.retryBackoffMs,
    });
  const processor: ReviewRunProcessor = createReviewRunProcessor({
    db: deps.db,
    config: deps.config,
    registry: deps.registry,
    client: deps.client,
    completionBus: deps.completionBus,
    persistence,
  });

  const active = new Set<Promise<void>>();
  const activeSessions = new Map<string, ActiveSession>();
  const signal = createSignal();
  let stopped = false;
  let loopPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  const tick = () => {
    if (stopped) {
      return;
    }

    while (active.size < deps.config.scheduler.globalConcurrency) {
      const run = claimNextQueuedReviewRun(
        deps.db,
        deps.config.scheduler.perRepoConcurrency,
      );
      if (!run) {
        break;
      }

      const promise = processor
        .process(run, activeSessions)
        .catch(() => {
          // Processor persists failures and intentionally does not rethrow.
        })
        .finally(() => {
          active.delete(promise);
          signal.notify();
        });
      active.add(promise);
    }
  };

  const runLoop = async () => {
    while (!stopped) {
      tick();
      if (stopped) break;
      await signal.wait(FALLBACK_HEARTBEAT_MS);
    }
  };

  loopPromise = runLoop();

  return {
    wake() {
      signal.notify();
    },
    stop(options) {
      if (stopPromise) {
        return stopPromise;
      }

      stopPromise = (async () => {
        stopped = true;
        signal.notify();
        await loopPromise;
        loopPromise = undefined;

        const cancelMessage = options?.cancelMessage ?? 'scheduler stopping';
        await Promise.allSettled(
          [...activeSessions.values()].map((activeSession) => {
            deps.completionBus.cancel(activeSession.sessionId, cancelMessage);
            return abortSession(
              deps.client,
              activeSession.sessionId,
              activeSession.directory,
            );
          }),
        );

        const settleAll = Promise.allSettled([...active]);
        const timeoutMs = options?.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
        if (timeoutMs <= 0) {
          await settleAll;
          return;
        }
        await Promise.race([settleAll, Bun.sleep(timeoutMs)]);
      })();

      return stopPromise;
    },
  };
}
