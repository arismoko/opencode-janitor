import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../../config/schema';
import {
  getCommitContext,
  getWorkspaceCommitContext,
} from '../../git/commit-resolver';
import type { EnrichmentData } from '../../history/enrichment';
import type { HistoryStore } from '../../history/store';
import { formatReport } from '../../results/formatter';
import { processReviewOutput } from '../../results/pipeline';
import { deliverToFile } from '../../results/sinks/file-sink';
import { deliverToSession } from '../../results/sinks/session-sink';
import { deliverToast } from '../../results/sinks/toast-sink';
import type {
  AgentRuntimeSpec,
  PreparedContext,
} from '../../runtime/agent-runtime-spec';
import type { Exec } from '../../runtime/runtime-types';
import { buildSuppressionsBlock } from '../../suppressions/prompt';
import type { SuppressionStore } from '../../suppressions/store';
import type { ReviewResult } from '../../types';
import { extractWorkspaceHeadFromKey } from '../../utils/review-key';
import type { BaseJob, ReviewStrategy } from '../review-run-queue';

export class JanitorStrategy implements ReviewStrategy<string, ReviewResult> {
  constructor(
    private readonly suppressionStore: SuppressionStore,
    private readonly historyStore: HistoryStore,
  ) {}

  /**
   * Create the janitor agent runtime spec.
   * Centralizes janitor-specific context resolution as strategy-owned data.
   */
  static createSpec(
    suppressionStore: SuppressionStore,
  ): AgentRuntimeSpec<string> {
    return {
      agent: 'janitor',
      queueTag: 'janitor',
      configKey: 'janitor',
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

  extractKey(sha: string): string {
    return sha;
  }

  errorLabel(key: string): string {
    return `commit \`${key.slice(0, 8)}\``;
  }

  async onJobCompleted(
    job: BaseJob<string, ReviewResult>,
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
    extractAssistantOutput: (
      sessionId: string,
      ctx: PluginInput,
    ) => Promise<string>,
  ): Promise<void> {
    const rawOutput = await extractAssistantOutput(sessionId, ctx);
    const sha = extractWorkspaceHeadFromKey(job.key);

    const pipelineResult = await processReviewOutput(rawOutput, sha, {
      suppressionStore: this.suppressionStore,
      historyStore: this.historyStore,
      config,
    });
    const result = pipelineResult.result;
    const enrichment = pipelineResult.enrichment;
    const suppressedCount = pipelineResult.suppressedCount;

    job.completedAt = new Date();
    job.result = result;

    await this.deliverResults(
      result,
      job.parentSessionId,
      ctx,
      config,
      enrichment,
      suppressedCount,
    );
  }

  private async deliverResults(
    result: ReviewResult,
    parentSessionId: string | undefined,
    ctx: PluginInput,
    config: JanitorConfig,
    enrichment?: EnrichmentData,
    suppressedCount?: number,
  ): Promise<void> {
    const report = formatReport(result, suppressedCount);
    const shortSha = result.sha.slice(0, 7);

    if (config.delivery.toast) {
      await deliverToast(ctx, result, {
        label: 'Janitor',
        shortId: shortSha,
        enrichment,
      });
    }

    if (config.delivery.sessionMessage && parentSessionId && !result.clean) {
      await deliverToSession(ctx, parentSessionId, report, {
        label: 'Janitor Review Complete',
        enrichment,
        noReply: config.delivery.noReply,
      });
    }

    if (config.delivery.reportFile) {
      await deliverToFile(report, {
        fileId: shortSha,
        reportDir: config.delivery.reportDir,
        workspaceDir: ctx.directory,
        enrichment,
      });
    }
  }
}
