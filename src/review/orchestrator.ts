import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import type { EnrichmentData } from '../history/enrichment';
import type { HistoryStore } from '../history/store';
import { formatReport } from '../results/formatter';
import { processReviewOutput } from '../results/pipeline';
import { deliverToFile } from '../results/sinks/file-sink';
import { deliverToSession } from '../results/sinks/session-sink';
import { deliverToast } from '../results/sinks/toast-sink';
import type { SuppressionStore } from '../suppressions/store';
import type { ReviewResult } from '../types';
import { log } from '../utils/logger';
import { type BaseJob, BaseOrchestrator } from './base-orchestrator';

type ReviewExecutor = (sha: string, parentSessionId: string) => Promise<string>;

/**
 * Janitor review orchestrator for commit-level structural reviews.
 *
 * Extends the shared base with:
 * - SHA-keyed deduplication
 * - Suppression/history pipeline integration
 * - Janitor-specific delivery sinks
 * - `onCompleted` callback for persisting reviewed SHAs
 */
export class ReviewOrchestrator extends BaseOrchestrator<string, ReviewResult> {
  private onReviewCompleted?: (sha: string) => void;

  constructor(
    config: JanitorConfig,
    executor: ReviewExecutor,
    private readonly suppressionStore: SuppressionStore,
    private readonly historyStore: HistoryStore,
  ) {
    super(config, executor, 'orchestrator');
  }

  /** Register a callback invoked when a review completes successfully. */
  onCompleted(callback: (sha: string) => void): void {
    this.onReviewCompleted = callback;
  }

  protected extractKey(sha: string): string {
    return sha;
  }

  protected errorLabel(key: string): string {
    return `commit \`${key.slice(0, 8)}\``;
  }

  protected async onJobCompleted(
    job: BaseJob<string, ReviewResult>,
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    const rawOutput = await this.extractAssistantOutput(sessionId, ctx);

    // Process through the full pipeline (parse -> suppress -> annotate -> record)
    const pipelineResult = await processReviewOutput(rawOutput, job.key, {
      suppressionStore: this.suppressionStore,
      historyStore: this.historyStore,
      config,
    });
    const result = pipelineResult.result;
    const enrichment = pipelineResult.enrichment;
    const suppressedCount = pipelineResult.suppressedCount;

    job.completedAt = new Date();
    job.result = result;

    // Persist the SHA as processed only after successful completion
    this.onReviewCompleted?.(job.key);

    // Deliver results via configured sinks
    await this.deliverResults(
      result,
      job.parentSessionId,
      ctx,
      config,
      enrichment,
      suppressedCount,
    );
  }

  /**
   * Deliver review results to all configured sinks.
   */
  private async deliverResults(
    result: ReviewResult,
    parentSessionId: string | undefined,
    ctx: PluginInput,
    config: JanitorConfig,
    enrichment?: EnrichmentData,
    suppressedCount?: number,
  ): Promise<void> {
    const report = formatReport(result, suppressedCount);

    if (config.delivery.toast) {
      await deliverToast(ctx, result, enrichment);
    }

    if (config.delivery.sessionMessage && parentSessionId && !result.clean) {
      await deliverToSession(ctx, parentSessionId, report, {
        enrichment,
        noReply: config.delivery.noReply,
      });
    }

    if (config.delivery.reportFile) {
      await deliverToFile(
        result,
        report,
        config.delivery.reportDir,
        ctx.directory,
        enrichment,
      );
    }
  }
}
