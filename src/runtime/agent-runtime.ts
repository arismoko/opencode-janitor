/**
 * Agent runtime — constructs review queues for janitor and hunter agents.
 *
 * Uses AgentRuntimeSpec to centralize per-agent differences as data,
 * replacing duplicated inline executor closures with a single generic factory.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import { isGhAvailable, postPrReviewWithGh } from '../git/gh-pr';
import type { PrContext } from '../git/pr-context-resolver';
import { buildReviewPrompt } from '../review/prompt-builder';
import { ReviewRunQueue } from '../review/review-run-queue';
import { spawnReview } from '../review/runner';
import { HunterStrategy } from '../review/strategies/hunter-strategy';
import { InspectorStrategy } from '../review/strategies/inspector-strategy';
import { JanitorStrategy } from '../review/strategies/janitor-strategy';
import type { HunterResult, InspectorResult, ReviewResult } from '../types';
import { log } from '../utils/logger';
import { extractHeadSha } from '../utils/review-key';
import type { AgentRuntimeRegistry } from './agent-runtime-registry';
import {
  type AgentRuntimeSpec,
  createSpecExecutor,
} from './agent-runtime-spec';
import type { BootstrapServices } from './bootstrap';
import type { Exec } from './runtime-types';

export interface AgentQueues {
  janitorQueue: ReviewRunQueue<string, ReviewResult>;
  hunterQueue: ReviewRunQueue<PrContext, HunterResult>;
  inspectorQueue: ReviewRunQueue<string, InspectorResult>;
}

// ---------------------------------------------------------------------------
// Queue construction
// ---------------------------------------------------------------------------

/**
 * Construct the janitor and hunter review queues.
 */
export function createAgentQueues(
  svc: BootstrapServices,
  registry: AgentRuntimeRegistry,
): AgentQueues {
  const {
    ctx,
    config,
    exec,
    store,
    suppressionStore,
    historyStore,
    trackedSessions,
    writeSessionMeta,
  } = svc;

  // Janitor
  const janitorSpec = registry.get<string>('janitor');
  const janitorStrategy = new JanitorStrategy(suppressionStore, historyStore);
  const janitorExecutor = createSpecExecutor(janitorSpec, {
    ctx,
    config,
    exec,
    trackedSessions,
    writeSessionMeta,
    buildPrompt: buildReviewPrompt,
    spawnReview,
    extractKey: janitorStrategy.extractKey.bind(janitorStrategy),
  });

  const janitorQueue = new ReviewRunQueue<string, ReviewResult>(
    config,
    janitorExecutor,
    janitorStrategy,
    janitorSpec.queueTag,
  );

  janitorQueue.onCompleted((sha) => {
    if (sha.startsWith('workspace:')) return;
    store.add(sha);
    log(`persisted reviewed commit: ${sha}`);
  });
  janitorQueue.setContext(ctx);

  // Hunter
  const hunterSpec = registry.get<PrContext>('hunter');
  const hunterStrategy = new HunterStrategy(
    async (prNumber: number, body: string) => {
      if (!(await isGhAvailable(exec))) return false;
      return postPrReviewWithGh(exec, prNumber, body);
    },
  );
  const hunterExecutor = createSpecExecutor(hunterSpec, {
    ctx,
    config,
    exec,
    trackedSessions,
    writeSessionMeta,
    buildPrompt: buildReviewPrompt,
    spawnReview,
    extractKey: hunterStrategy.extractKey.bind(hunterStrategy),
  });

  const hunterQueue = new ReviewRunQueue<PrContext, HunterResult>(
    config,
    hunterExecutor,
    hunterStrategy,
    hunterSpec.queueTag,
  );
  hunterQueue.setContext(ctx);
  hunterQueue.onCompleted((key: string) => {
    if (key.startsWith('workspace:')) return;
    store.addPrKey(key);
    const headSha = extractHeadSha(key);
    if (headSha) {
      store.addProcessedHunterHead(headSha);
    }
    log(`persisted reviewed PR key: ${key}`);
  });

  // Inspector
  const inspectorSpec = registry.get<string>('inspector');
  const inspectorStrategy = new InspectorStrategy();
  const inspectorExecutor = createSpecExecutor(inspectorSpec, {
    ctx,
    config,
    exec,
    trackedSessions,
    writeSessionMeta,
    buildPrompt: buildReviewPrompt,
    spawnReview,
    extractKey: inspectorStrategy.extractKey.bind(inspectorStrategy),
  });

  const inspectorQueue = new ReviewRunQueue<string, InspectorResult>(
    config,
    inspectorExecutor,
    inspectorStrategy,
    inspectorSpec.queueTag,
  );
  inspectorQueue.setContext(ctx);

  return { janitorQueue, hunterQueue, inspectorQueue };
}
