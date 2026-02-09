/**
 * Agent runtime — constructs review queues for janitor and hunter agents.
 *
 * Uses AgentRuntimeSpec to centralize per-agent differences as data,
 * replacing duplicated inline executor closures with a single generic factory.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import {
  getCommitContext,
  getWorkspaceCommitContext,
} from '../git/commit-resolver';
import { isGhAvailable, postPrReviewWithGh } from '../git/gh-pr';
import type { PrContext } from '../git/pr-context-resolver';
import { buildReviewPrompt } from '../review/prompt-builder';
import { ReviewRunQueue } from '../review/review-run-queue';
import { spawnReview } from '../review/runner';
import { HunterStrategy } from '../review/strategies/hunter-strategy';
import { JanitorStrategy } from '../review/strategies/janitor-strategy';
import { buildSuppressionsBlock } from '../suppressions/prompt';
import type { HunterResult, ReviewResult } from '../types';
import { log } from '../utils/logger';
import { extractHeadSha } from '../utils/review-key';
import {
  type AgentRuntimeSpec,
  createSpecExecutor,
  type PreparedContext,
} from './agent-runtime-spec';
import type { BootstrapServices } from './bootstrap';
import type { Exec } from './context';

export interface AgentQueues {
  orchestrator: ReviewRunQueue<string, ReviewResult>;
  hunterOrchestrator: ReviewRunQueue<PrContext, HunterResult>;
}

// ---------------------------------------------------------------------------
// Agent runtime specs — per-agent differences as data
// ---------------------------------------------------------------------------

function createJanitorSpec(
  suppressionStore: BootstrapServices['suppressionStore'],
): AgentRuntimeSpec<string> {
  return {
    agent: 'janitor',
    queueTag: 'orchestrator',
    resolveModelId: (config) =>
      config.agents.janitor.modelId ?? config.model.id,

    async prepareReviewContext(
      runKey: string,
      config: JanitorConfig,
      exec: Exec,
    ): Promise<PreparedContext> {
      const workspace = runKey.startsWith('workspace:');
      const commit = workspace
        ? await getWorkspaceCommitContext(config, exec)
        : await getCommitContext(runKey, config, exec);

      if (!commit.patch.trim() && commit.changedFiles.length === 0) {
        throw new Error(
          `Empty commit context for ${commit.sha.slice(0, 8)} — no patch or changed files`,
        );
      }

      const suppressionsBlock = config.suppressions?.enabled
        ? buildSuppressionsBlock(
            suppressionStore.getActive(),
            config.suppressions?.maxPromptBytes,
          )
        : '';

      return {
        reviewContext: {
          label: `${commit.sha.slice(0, 8)} — ${commit.subject}`,
          changedFiles: commit.changedFiles,
          patch: commit.patch,
          patchTruncated: commit.patchTruncated,
          metadata: [
            `SHA: ${commit.sha}`,
            `Subject: ${commit.subject}`,
            `Parents: ${commit.parents.join(' ')}`,
          ],
        },
        suppressionsBlock,
      };
    },

    sessionTitle: (runKey) => `[janitor-run] ${runKey}`,
  };
}

function createHunterSpec(): AgentRuntimeSpec<PrContext> {
  return {
    agent: 'bug-hunter',
    queueTag: 'hunter-orchestrator',
    resolveModelId: (config) => config.agents.hunter.modelId ?? config.model.id,

    async prepareReviewContext(
      prContext: PrContext,
      _config: JanitorConfig,
      _exec: Exec,
    ): Promise<PreparedContext> {
      return {
        reviewContext: {
          label: prContext.number ? `PR #${prContext.number}` : prContext.key,
          changedFiles: prContext.changedFiles,
          patch: prContext.patch,
          patchTruncated: prContext.patchTruncated,
          metadata: [
            `Base: ${prContext.baseRef}`,
            `Head: ${prContext.headRef}`,
            `Head SHA: ${prContext.headSha}`,
          ],
        },
      };
    },

    sessionTitle: (prContext) => `[hunter-run] ${prContext.key}`,
  };
}

// ---------------------------------------------------------------------------
// Queue construction
// ---------------------------------------------------------------------------

/**
 * Construct the janitor and hunter review queues.
 */
export function createAgentQueues(svc: BootstrapServices): AgentQueues {
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
  const janitorSpec = createJanitorSpec(suppressionStore);
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

  const orchestrator = new ReviewRunQueue<string, ReviewResult>(
    config,
    janitorExecutor,
    janitorStrategy,
    janitorSpec.queueTag,
  );

  orchestrator.onCompleted((sha) => {
    if (sha.startsWith('workspace:')) return;
    store.add(sha);
    log(`persisted reviewed commit: ${sha}`);
  });
  orchestrator.setContext(ctx);

  // Hunter
  const hunterSpec = createHunterSpec();
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

  const hunterOrchestrator = new ReviewRunQueue<PrContext, HunterResult>(
    config,
    hunterExecutor,
    hunterStrategy,
    hunterSpec.queueTag,
  );
  hunterOrchestrator.setContext(ctx);
  hunterOrchestrator.onCompleted((key: string) => {
    if (key.startsWith('workspace:')) return;
    store.addPrKey(key);
    const headSha = extractHeadSha(key);
    if (headSha) {
      store.addProcessedHunterHead(headSha);
    }
    log(`persisted reviewed PR key: ${key}`);
  });

  return { orchestrator, hunterOrchestrator };
}
