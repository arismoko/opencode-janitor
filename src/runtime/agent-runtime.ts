/**
 * Agent runtime — constructs review queues for janitor and hunter agents.
 */

import type { PluginInput } from '@opencode-ai/plugin';
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
import type { BootstrapServices } from './bootstrap';

export interface AgentQueues {
  orchestrator: ReviewRunQueue<string, ReviewResult>;
  hunterOrchestrator: ReviewRunQueue<PrContext, HunterResult>;
}

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

  // Janitor orchestrator
  const janitorStrategy = new JanitorStrategy(suppressionStore, historyStore);
  const orchestrator = new ReviewRunQueue<string, ReviewResult>(
    config,
    async (runKey, parentSessionId) => {
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
      const prompt = buildReviewPrompt(
        {
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
        {
          maxFindings: config.model.maxFindings,
          scopeInclude: config.scope.include,
          scopeExclude: config.scope.exclude,
          suppressionsBlock,
        },
      );

      const sessionId = await spawnReview(ctx, {
        prompt,
        title: `[janitor-run] ${runKey}`,
        agent: 'janitor',
        modelId: config.agents.janitor.modelId ?? config.model.id,
        parentID: parentSessionId,
      });
      trackedSessions.add(sessionId);
      writeSessionMeta(sessionId, {
        title: `[janitor-run] ${runKey}`,
        agent: 'janitor',
        key: runKey,
        status: 'running',
        startedAt: Date.now(),
      });
      return sessionId;
    },
    janitorStrategy,
    'orchestrator',
  );

  orchestrator.onCompleted((sha) => {
    if (sha.startsWith('workspace:')) return;
    store.add(sha);
    log(`persisted reviewed commit: ${sha}`);
  });
  orchestrator.setContext(ctx);

  // Hunter orchestrator
  const hunterStrategy = new HunterStrategy(
    async (prNumber: number, body: string) => {
      if (!(await isGhAvailable(exec))) return false;
      return postPrReviewWithGh(exec, prNumber, body);
    },
  );
  const hunterOrchestrator = new ReviewRunQueue<PrContext, HunterResult>(
    config,
    async (prContext: PrContext, parentSessionId?: string) => {
      const id = prContext.number ? `PR #${prContext.number}` : prContext.key;
      const prompt = buildReviewPrompt(
        {
          label: id,
          changedFiles: prContext.changedFiles,
          patch: prContext.patch,
          patchTruncated: prContext.patchTruncated,
          metadata: [
            `Base: ${prContext.baseRef}`,
            `Head: ${prContext.headRef}`,
            `Head SHA: ${prContext.headSha}`,
          ],
        },
        {
          maxFindings: config.model.maxFindings,
          scopeInclude: config.scope.include,
          scopeExclude: config.scope.exclude,
        },
      );

      const sessionId = await spawnReview(ctx, {
        prompt,
        title: `[hunter-run] ${prContext.key}`,
        agent: 'bug-hunter',
        modelId: config.agents.hunter.modelId ?? config.model.id,
        parentID: parentSessionId,
      });
      trackedSessions.add(sessionId);
      writeSessionMeta(sessionId, {
        title: `[hunter-run] ${prContext.key}`,
        agent: 'bug-hunter',
        key: prContext.key,
        status: 'running',
        startedAt: Date.now(),
      });
      return sessionId;
    },
    hunterStrategy,
    'hunter-orchestrator',
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
