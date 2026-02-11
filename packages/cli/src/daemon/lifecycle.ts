import { appendEvent } from '../db/queries/event-queries';
import {
  type BootstrapRuntimeOptions,
  bootstrapRuntime,
  shutdownRuntime,
} from '../runtime/bootstrap';
import type { SocketContext } from '../runtime/context';
import { toWebUrl } from '../utils/web-url';
import { CLI_VERSION } from '../version';
import { generateAuthToken, writeAuthToken } from './auth';
import { createSocketServer, type DaemonStatusSnapshot } from './socket';
import { createSocketOptions } from './socket-options';
import { createWebServer } from './web';

export interface RunDaemonOptions extends BootstrapRuntimeOptions {}

const SCHEDULER_DRAIN_TIMEOUT_MS = 10_000;
const SHUTDOWN_CANCEL_MESSAGE = 'daemon stopping';

function buildStatusSnapshot(
  rc: SocketContext,
  draining: boolean,
): DaemonStatusSnapshot {
  return {
    pid: process.pid,
    version: CLI_VERSION,
    uptimeMs: Date.now() - rc.startedAt,
    draining,
    socketPath: rc.config.daemon.socketPath,
    dbPath: rc.dbPath,
    webHost: rc.config.daemon.webHost,
    webPort: rc.config.daemon.webPort,
  };
}

export async function runDaemon(options: RunDaemonOptions): Promise<void> {
  const { rc, recoveredReviewRuns } = await bootstrapRuntime(options);

  let draining = false;
  let resolved = false;
  let resolveStop: (() => void) | null = null;
  const statusSnapshot = (): DaemonStatusSnapshot =>
    buildStatusSnapshot(rc, draining);

  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  let server: ReturnType<typeof createSocketServer> | null = null;
  let webServer: ReturnType<typeof createWebServer> | null = null;
  try {
    // Generate and persist auth token for the web server.
    const authToken = generateAuthToken();
    writeAuthToken(authToken);

    const socketOptions = createSocketOptions(rc, statusSnapshot, shutdown);

    server = createSocketServer(socketOptions);
    webServer = createWebServer({
      hostname: rc.config.daemon.webHost,
      port: rc.config.daemon.webPort,
      apiOptions: socketOptions,
      authToken,
    });
  } catch (error) {
    server?.stop(true);
    webServer?.stop(true);
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
        recoveredReviewRuns > 0
          ? {
              recoveredReviewRuns,
              webUrl: toWebUrl(
                rc.config.daemon.webHost,
                rc.config.daemon.webPort,
              ),
            }
          : {
              webUrl: toWebUrl(
                rc.config.daemon.webHost,
                rc.config.daemon.webPort,
              ),
            },
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

    server?.stop(true);
    webServer?.stop(true);
    resolveStop?.();
  }

  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  await shutdownRuntime(rc, {
    schedulerDrainTimeoutMs: SCHEDULER_DRAIN_TIMEOUT_MS,
    cancelMessage: SHUTDOWN_CANCEL_MESSAGE,
  });
}
