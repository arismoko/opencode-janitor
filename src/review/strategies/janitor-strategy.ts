import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../../config/schema';
import type { EnrichmentData } from '../../history/enrichment';
import type { HistoryStore } from '../../history/store';
import { formatReport } from '../../results/formatter';
import { processReviewOutput } from '../../results/pipeline';
import { deliverToFile } from '../../results/sinks/file-sink';
import { deliverToSession } from '../../results/sinks/session-sink';
import { deliverToast } from '../../results/sinks/toast-sink';
import type { SuppressionStore } from '../../suppressions/store';
import type { ReviewResult } from '../../types';
import { extractWorkspaceHeadFromKey } from '../../utils/review-key';
import type { BaseJob, ReviewStrategy } from '../review-run-queue';

export class JanitorStrategy implements ReviewStrategy<string, ReviewResult> {
  constructor(
    private readonly suppressionStore: SuppressionStore,
    private readonly historyStore: HistoryStore,
  ) {}

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
