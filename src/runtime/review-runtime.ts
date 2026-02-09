/**
 * Review runtime — thin composition root.
 *
 * Delegates to:
 * - bootstrap.ts: config/services/stores
 * - agent-runtime.ts: review queue construction
 * - detector-runtime.ts: commit/PR detector wiring
 */

import type { PluginInput } from '@opencode-ai/plugin';
import { HunterStrategy } from '../review/strategies/hunter-strategy';
import { InspectorStrategy } from '../review/strategies/inspector-strategy';
import { JanitorStrategy } from '../review/strategies/janitor-strategy';
import { ScribeStrategy } from '../review/strategies/scribe-strategy';
import { log } from '../utils/logger';
import { createAgentQueues } from './agent-runtime';
import { AgentRuntimeRegistry } from './agent-runtime-registry';
import { bootstrapServices } from './bootstrap';
import type { RuntimeContext } from './context';
import { createDetectors } from './detector-runtime';
import { SessionOwnershipDispatcher } from './session-ownership-dispatcher';

export interface BootstrapResult {
  rc: RuntimeContext;
  stop: () => Promise<void>;
}

/**
 * Bootstrap the review runtime.
 *
 * Returns the fully populated RuntimeContext and a stop function for teardown.
 * Returns null if the plugin should be inactive (no git repo or disabled).
 */
export async function bootstrapRuntime(
  ctx: PluginInput,
): Promise<BootstrapResult | null> {
  const svc = await bootstrapServices(ctx);
  if (!svc) return null;

  // Build agent runtime registry — each strategy owns its spec
  const registry = new AgentRuntimeRegistry();
  registry.register(JanitorStrategy.createSpec(svc.suppressionStore));
  registry.register(HunterStrategy.createSpec());
  registry.register(InspectorStrategy.createSpec());
  registry.register(ScribeStrategy.createSpec());

  const { janitorQueue, hunterQueue, inspectorQueue, scribeQueue } =
    createAgentQueues(svc, registry);

  // Session ownership dispatcher — targeted event routing instead of broadcast
  const dispatcher = new SessionOwnershipDispatcher();
  janitorQueue.setDispatcher(dispatcher);
  hunterQueue.setDispatcher(dispatcher);
  inspectorQueue.setDispatcher(dispatcher);
  scribeQueue.setDispatcher(dispatcher);

  // Forward-declare rcRef so closures created below can reference it.
  // By the time any closure executes (after start()), rcRef is assigned.
  let rcRef: RuntimeContext;

  const { detector, prDetector } = createDetectors(
    svc,
    janitorQueue,
    hunterQueue,
    () => rcRef,
  );

  // Pre-seed processed SHAs
  if (svc.janitorCommitEnabled) {
    for (const sha of svc.previouslyProcessed) {
      detector.markProcessed(sha);
    }
  }

  if (svc.anyCommitReviews) {
    await detector.start(svc.gitDir);
  }

  // Build RuntimeContext — must be assigned before starting prDetector
  // because prDetector closures reference rcRef.branchPushPending.
  rcRef = {
    ctx: svc.ctx,
    config: svc.config,
    exec: svc.exec,
    gitDir: svc.gitDir,
    stateDir: svc.stateDir,
    store: svc.store,
    suppressionStore: svc.suppressionStore,
    historyStore: svc.historyStore,
    janitorQueue,
    hunterQueue,
    inspectorQueue,
    scribeQueue,
    dispatcher,
    detector,
    prDetector,
    trackedSessions: svc.trackedSessions,
    control: svc.control,
    runtime: svc.runtime,
    ghAvailableAtStartup: svc.ghAvailableAtStartup,
    branchPushPending: false,
    janitorCommitEnabled: svc.janitorCommitEnabled,
    janitorPrEnabled: svc.janitorPrEnabled,
    hunterCommitEnabled: svc.hunterCommitEnabled,
    hunterPrEnabled: svc.hunterPrEnabled,
    anyCommitReviews: svc.anyCommitReviews,
    anyPrReviews: svc.anyPrReviews,
    writeSessionMeta: svc.writeSessionMeta,
  };

  if (prDetector) {
    for (const key of svc.previouslyProcessedPrKeys) {
      prDetector.markProcessed(key);
    }
    prDetector.start();
  }

  const stop = async () => {
    svc.runtime.disposed = true;
    detector.stop();
    prDetector?.stop();
    const allQueues = [janitorQueue, hunterQueue, inspectorQueue, scribeQueue];
    for (const q of allQueues) {
      q.shutdown();
      q.clearPending();
    }
    await Promise.all(allQueues.map((q) => q.abortRunning(ctx)));
    log('plugin runtime stopped: detectors halted');
  };

  log(`initialized — watching ${svc.gitDir}`);

  return { rc: rcRef, stop };
}
