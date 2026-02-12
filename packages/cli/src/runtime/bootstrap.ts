import { loadConfig } from '../config/loader';
import { defaultDbPath } from '../config/paths';
import { acquireProcessLock } from '../daemon/lock';
import { openDatabase } from '../db/connection';
import { ensureSchema } from '../db/migrations';
import { recoverRunningReviewRuns } from '../db/queries/review-run-queries';
import { startScheduler } from '../scheduler/worker';
import { startTriggerEngine } from '../triggers/engine';
import { createAgentConfigMap } from './agent-factory';
import type { RuntimeContext, ShutdownContext } from './context';
import { createDefinitionAgentRegistry } from './definition-agent-registry';
import { startOpencodeChild } from './opencode-child';
import { createSessionCompletionBus } from './session-completion-bus';
import { createSessionEventProjector } from './session-event-projector';

export interface BootstrapRuntimeOptions {
  configPath?: string;
}

export interface BootstrapRuntimeResult {
  rc: RuntimeContext;
  recoveredReviewRuns: number;
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
  const recoveredReviewRuns = recoverRunningReviewRuns(db);

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

    const registry = createDefinitionAgentRegistry();
    const sessionEventProjector = createSessionEventProjector(db);

    const completionBus = createSessionCompletionBus({
      client: child.client,
      onEventTap: (event) => {
        sessionEventProjector.handle(event);
      },
    });
    completionBus.start();

    const scheduler = startScheduler({
      db,
      client: child.client,
      config,
      registry,
      completionBus,
    });

    const watch = startTriggerEngine({
      db,
      maxAttempts: config.scheduler.maxAttempts,
      config,
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
      recoveredReviewRuns,
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
