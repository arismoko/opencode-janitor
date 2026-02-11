import type { Event } from '@opencode-ai/sdk';
import { loadConfig } from '../config/loader';
import { defaultDbPath } from '../config/paths';
import { acquireProcessLock } from '../daemon/lock';
import { openDatabase } from '../db/connection';
import { ensureSchema } from '../db/migrations';
import {
  appendEvent,
  findAgentRunContextBySessionId,
  recoverRunningAgentRuns,
  recoverRunningJobs,
} from '../db/queries';
import { startRepoWatch } from '../detectors/repo-watch';
import { startScheduler } from '../scheduler/worker';
import { createAgentConfigMap } from './agent-factory';
import type { RuntimeContext, ShutdownContext } from './context';
import { createDefaultAgentRegistry } from './default-agent-specs';
import { startOpencodeChild } from './opencode-child';
import { createSessionCompletionBus } from './session-completion-bus';

export interface BootstrapRuntimeOptions {
  configPath?: string;
}

export interface BootstrapRuntimeResult {
  rc: RuntimeContext;
  recoveredJobs: number;
  recoveredAgentRuns: number;
}

export interface ShutdownRuntimeOptions {
  schedulerDrainTimeoutMs: number;
  cancelMessage: string;
}

/** Map CLI log level to opencode SDK log level. */
function mapLogLevel(
  level: 'debug' | 'info' | 'warn' | 'error',
): 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' {
  return level.toUpperCase() as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
}

/**
 * Build and start the daemon runtime as a composed context.
 *
 * This is the CLI composition root for services consumed by daemon lifecycle
 * handlers (scheduler, detector, socket, and shutdown).
 */
export async function bootstrapRuntime(
  options: BootstrapRuntimeOptions,
): Promise<BootstrapRuntimeResult> {
  const config = loadConfig(options.configPath);

  const lock = acquireProcessLock({
    lockFile: config.daemon.lockFile,
    pidFile: config.daemon.pidFile,
    socketPath: config.daemon.socketPath,
  });

  const dbPath = defaultDbPath();
  const db = openDatabase(dbPath);

  ensureSchema(db);
  const recoveredJobs = recoverRunningJobs(db);
  const recoveredAgentRuns = recoverRunningAgentRuns(db);

  const agentDefinitions = createAgentConfigMap(config);
  const agentConfigEntries = Object.fromEntries(
    Object.entries(agentDefinitions).map(([name, def]) => [name, def.config]),
  );

  try {
    const child = await startOpencodeChild({
      host: config.opencode.serverHost,
      port: config.opencode.serverPort,
      startTimeoutMs: config.opencode.serverStartTimeoutMs,
      config: {
        agent: agentConfigEntries,
      },
      logLevel: mapLogLevel(config.daemon.logLevel),
    });

    const registry = createDefaultAgentRegistry();

    /** Extract sessionID from known event shapes. */
    function extractSessionId(event: Event): string | undefined {
      switch (event.type) {
        case 'session.status':
        case 'session.idle':
          return event.properties.sessionID;
        case 'session.error':
          return event.properties.sessionID ?? undefined;
        case 'message.part.updated':
          return event.properties.part.sessionID;
        default:
          return undefined;
      }
    }

    /** Non-blocking event tap: writes live session events to event_journal. */
    function onEventTap(event: Event): void {
      const sessionId = extractSessionId(event);
      if (!sessionId) return;

      const ctx = findAgentRunContextBySessionId(db, sessionId);
      if (!ctx) return;

      const base = {
        repoId: ctx.repoId,
        jobId: ctx.jobId,
        agentRunId: ctx.agentRunId,
      };

      switch (event.type) {
        case 'message.part.updated': {
          const { delta, part } = event.properties;
          if (!delta) return;
          appendEvent(db, {
            ...base,
            eventType: 'session.delta',
            level: 'info',
            message: 'Session output chunk',
            payload: {
              sessionId,
              delta,
              partType: part.type,
              messageId: part.messageID,
              partId: part.id,
              agent: ctx.agent,
            },
          });
          return;
        }
        case 'session.status': {
          // Intentionally not logged — busy/idle transitions are noise.
          // The meaningful lifecycle event (session.idle) is handled below.
          return;
        }
        case 'session.idle': {
          appendEvent(db, {
            ...base,
            eventType: 'session.idle',
            level: 'info',
            message: 'Session idle',
            payload: { sessionId },
          });
          return;
        }
        case 'session.error': {
          appendEvent(db, {
            ...base,
            eventType: 'session.error',
            level: 'error',
            message: 'Session error',
            payload: {
              sessionId,
              error: event.properties.error,
            },
          });
          return;
        }
      }
    }

    const completionBus = createSessionCompletionBus({
      client: child.client,
      onEventTap,
    });
    completionBus.start();

    const scheduler = startScheduler({
      db,
      client: child.client,
      config,
      registry,
      completionBus,
    });

    const watch = startRepoWatch({
      db,
      minPollSec: config.detector.minPollSec,
      maxPollSec: config.detector.maxPollSec,
      probeConcurrency: config.detector.probeConcurrency,
      prTtlSec: config.detector.prTtlSec,
      pollJitterPct: config.detector.pollJitterPct,
      maxAttempts: config.scheduler.maxAttempts,
      onJobEnqueued: () => {
        scheduler.wake();
      },
    });

    return {
      rc: {
        config,
        dbPath,
        startedAt: Date.now(),
        lock,
        db,
        child,
        registry,
        completionBus,
        watch,
        scheduler,
      },
      recoveredJobs,
      recoveredAgentRuns,
    };
  } catch (error) {
    try {
      db.close(false);
    } finally {
      lock.release();
    }
    throw error;
  }
}

/**
 * Stop runtime services in cancellation-first order and release resources.
 */
export async function shutdownRuntime(
  rc: ShutdownContext,
  options: ShutdownRuntimeOptions,
): Promise<void> {
  rc.watch.stop();
  rc.completionBus.cancelAll(options.cancelMessage);

  try {
    await rc.scheduler.stop({
      timeoutMs: options.schedulerDrainTimeoutMs,
      cancelMessage: options.cancelMessage,
    });
    await rc.completionBus.stop(options.cancelMessage);
    rc.db.close(false);
  } finally {
    await rc.child.close();
    rc.lock.release();
  }
}
