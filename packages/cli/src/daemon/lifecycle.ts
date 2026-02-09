import { resolve as resolvePath } from 'node:path';
import { manualKey } from '@opencode-janitor/shared';
import {
  appendEvent,
  enqueueTriggerAndJob,
  findRepoByIdOrPath,
  listEventsAfterSeq,
} from '../db/queries';
import {
  type BootstrapRuntimeOptions,
  bootstrapRuntime,
  shutdownRuntime,
} from '../runtime/bootstrap';
import type { SocketContext } from '../runtime/context';
import { resolveHeadSha } from '../utils/git';
import { createSocketServer, type DaemonStatusSnapshot } from './socket';

export interface RunDaemonOptions extends BootstrapRuntimeOptions {}

const SCHEDULER_DRAIN_TIMEOUT_MS = 10_000;
const SHUTDOWN_CANCEL_MESSAGE = 'daemon stopping';

function buildStatusSnapshot(
  rc: SocketContext,
  draining: boolean,
): DaemonStatusSnapshot {
  return {
    pid: process.pid,
    version: '0.1.0',
    uptimeMs: Date.now() - rc.startedAt,
    draining,
    socketPath: rc.config.daemon.socketPath,
    dbPath: rc.dbPath,
  };
}

export async function runDaemon(options: RunDaemonOptions): Promise<void> {
  const { rc, recoveredJobs, recoveredAgentRuns } =
    await bootstrapRuntime(options);

  let draining = false;
  let resolved = false;
  let resolveStop: (() => void) | null = null;
  const statusSnapshot = (): DaemonStatusSnapshot =>
    buildStatusSnapshot(rc, draining);

  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  let server: ReturnType<typeof createSocketServer>;
  try {
    server = createSocketServer({
      socketPath: rc.config.daemon.socketPath,
      getStatus: statusSnapshot,
      onStopRequested: () => {
        shutdown();
      },
      onEnqueueReview: async ({ repoOrId }) => {
        const normalized = resolvePath(repoOrId);
        const repo =
          findRepoByIdOrPath(rc.db, normalized) ??
          findRepoByIdOrPath(rc.db, repoOrId);

        if (!repo) {
          throw new Error(
            `Repository not found: ${repoOrId}. Use \`janitor add\` first.`,
          );
        }

        const sha = resolveHeadSha(repo.path);
        const subjectKey = manualKey(String(Date.now()), sha);
        const enqueued = enqueueTriggerAndJob(rc.db, {
          repoId: repo.id,
          kind: 'manual',
          source: 'cli',
          subjectKey,
          payload: { sha, manual: true },
          maxAttempts: rc.config.scheduler.maxAttempts,
        });

        if (enqueued) {
          rc.scheduler.wake();
          appendEvent(rc.db, {
            eventType: 'review.enqueued',
            repoId: repo.id,
            message: `Manual review enqueued for ${sha.slice(0, 10)}`,
            level: 'info',
            payload: { sha, subjectKey },
          });
        }

        return {
          ok: true as const,
          enqueued,
          repoId: repo.id,
          repoPath: repo.path,
          sha,
          subjectKey,
        };
      },
      listEventsAfterSeq: (afterSeq, limit) =>
        listEventsAfterSeq(rc.db, afterSeq, limit),
    });
  } catch (error) {
    await shutdownRuntime(rc, {
      schedulerDrainTimeoutMs: SCHEDULER_DRAIN_TIMEOUT_MS,
      cancelMessage: SHUTDOWN_CANCEL_MESSAGE,
    });
    throw error;
  }

  const onSignal = () => shutdown();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    appendEvent(rc.db, {
      eventType: 'daemon.started',
      message: 'Daemon started',
      level: 'info',
      payload:
        recoveredJobs > 0 || recoveredAgentRuns > 0
          ? {
              recoveredJobs,
              recoveredAgentRuns,
            }
          : undefined,
    });
  } catch {
    // Ignore startup event logging failures.
  }

  await stopPromise;

  function shutdown(): void {
    if (resolved) {
      return;
    }

    resolved = true;
    draining = true;

    try {
      appendEvent(rc.db, {
        eventType: 'daemon.stopping',
        message: 'Daemon stop requested',
        level: 'info',
      });
    } catch {
      // Ignore shutdown event logging failures.
    }

    server.stop(true);
    resolveStop?.();
  }

  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  await shutdownRuntime(rc, {
    schedulerDrainTimeoutMs: SCHEDULER_DRAIN_TIMEOUT_MS,
    cancelMessage: SHUTDOWN_CANCEL_MESSAGE,
  });
}
