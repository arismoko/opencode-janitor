import { loadConfig } from '../config/loader';
import { defaultDbPath } from '../config/paths';
import { openDatabase } from '../db/connection';
import { runMigrations } from '../db/migrations';
import {
  appendEvent,
  recoverRunningAgentRuns,
  recoverRunningJobs,
} from '../db/queries';
import { startRepoWatch } from '../detectors/repo-watch';
import { createAgentConfigMap } from '../runtime/agent-factory';
import { createDefaultAgentRegistry } from '../runtime/default-agent-specs';
import {
  type OpencodeChild,
  startOpencodeChild,
} from '../runtime/opencode-child';
import { createSessionCompletionBus } from '../runtime/session-completion-bus';
import { startScheduler } from '../scheduler/worker';
import { acquireProcessLock } from './lock';
import { createSocketServer, type DaemonStatusSnapshot } from './socket';

export interface RunDaemonOptions {
  configPath?: string;
}

const SCHEDULER_DRAIN_TIMEOUT_MS = 10_000;
const SHUTDOWN_CANCEL_MESSAGE = 'daemon stopping';

/** Map CLI log level to opencode SDK log level. */
function mapLogLevel(
  level: 'debug' | 'info' | 'warn' | 'error',
): 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' {
  return level.toUpperCase() as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
}

export async function runDaemon(options: RunDaemonOptions): Promise<void> {
  const config = loadConfig(options.configPath);

  const lock = acquireProcessLock({
    lockFile: config.daemon.lockFile,
    pidFile: config.daemon.pidFile,
    socketPath: config.daemon.socketPath,
  });

  const dbPath = defaultDbPath();
  const db = openDatabase(dbPath);

  runMigrations(db);
  const recoveredJobs = recoverRunningJobs(db);
  const recoveredAgentRuns = recoverRunningAgentRuns(db);

  // Build agent config map from profiles + CLI config (data-driven)
  const agentDefinitions = createAgentConfigMap(config);
  const agentConfigEntries = Object.fromEntries(
    Object.entries(agentDefinitions).map(([name, def]) => [name, def.config]),
  );

  let child: OpencodeChild;
  try {
    child = await startOpencodeChild({
      host: config.opencode.serverHost,
      port: config.opencode.serverPort,
      startTimeoutMs: config.opencode.serverStartTimeoutMs,
      config: {
        agent: agentConfigEntries,
      },
      logLevel: mapLogLevel(config.daemon.logLevel),
    });
  } catch (error) {
    try {
      db.close(false);
    } finally {
      lock.release();
    }
    throw error;
  }

  // Build runtime registry for the scheduler
  const registry = createDefaultAgentRegistry();
  const completionBus = createSessionCompletionBus({ client: child.client });
  completionBus.start();

  const startedAt = Date.now();
  let draining = false;
  let resolved = false;
  let shutdownDrain: Promise<void> | undefined;
  let resolveStop: (() => void) | null = null;

  const statusSnapshot = (): DaemonStatusSnapshot => ({
    pid: process.pid,
    version: '0.1.0',
    uptimeMs: Date.now() - startedAt,
    draining,
    socketPath: config.daemon.socketPath,
    dbPath,
  });

  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  let server: ReturnType<typeof createSocketServer>;
  try {
    server = createSocketServer({
      socketPath: config.daemon.socketPath,
      getStatus: statusSnapshot,
      onStopRequested: () => {
        shutdown();
      },
    });
  } catch (error) {
    try {
      await completionBus.stop();
      db.close(false);
    } finally {
      await child.close();
      lock.release();
    }
    throw error;
  }

  const onSignal = () => shutdown();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const watch = startRepoWatch({
    db,
    commitPollMs: config.git.commitPollSec * 1000,
    prPollMs: config.git.prPollSec * 1000,
  });

  const scheduler = startScheduler({
    db,
    client: child.client,
    config,
    registry,
    completionBus,
  });

  try {
    appendEvent(db, {
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
      watch.stop();
      completionBus.cancelAll(SHUTDOWN_CANCEL_MESSAGE);
      shutdownDrain = scheduler.stop({
        timeoutMs: SCHEDULER_DRAIN_TIMEOUT_MS,
        cancelMessage: SHUTDOWN_CANCEL_MESSAGE,
      });

      appendEvent(db, {
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

  try {
    await (shutdownDrain ??
      scheduler.stop({
        timeoutMs: SCHEDULER_DRAIN_TIMEOUT_MS,
        cancelMessage: SHUTDOWN_CANCEL_MESSAGE,
      }));
    await completionBus.stop(SHUTDOWN_CANCEL_MESSAGE);
    db.close(false);
  } finally {
    await child.close();
    lock.release();
  }
}
