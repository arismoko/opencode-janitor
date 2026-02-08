import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import type { PrContext } from '../git/pr-context-resolver';
import { formatReviewerReport } from '../results/reviewer-formatter';
import { parseReviewerOutput } from '../results/reviewer-parser';
import { deliverReviewerToFile } from '../results/sinks/reviewer-file-sink';
import { deliverReviewerToSession } from '../results/sinks/reviewer-session-sink';
import { deliverReviewerToast } from '../results/sinks/reviewer-toast-sink';
import { log } from '../utils/logger';
import { type BaseJob, BaseOrchestrator } from './base-orchestrator';

type ReviewerExecutor = (
  context: PrContext,
  parentSessionId: string,
) => Promise<string>;

type GhPostReview = (prNumber: number, body: string) => Promise<boolean>;

/** Parsed reviewer output shape (imported from parser). */
type ReviewerResult = ReturnType<typeof parseReviewerOutput>;

/**
 * Comprehensive code reviewer orchestrator for PR-level reviews.
 *
 * Extends the shared base with:
 * - PrContext-keyed deduplication
 * - Reviewer-specific JSON parsing
 * - Reviewer delivery sinks (including gh pr review)
 */
export class ReviewerOrchestrator extends BaseOrchestrator<
  PrContext,
  ReviewerResult
> {
  constructor(
    config: JanitorConfig,
    executor: ReviewerExecutor,
    private readonly postGhReview?: GhPostReview,
  ) {
    super(config, executor, 'reviewer-orchestrator');
  }

  protected extractKey(context: PrContext): string {
    return context.key;
  }

  protected errorLabel(key: string): string {
    return `\`${key}\``;
  }

  protected async onJobCompleted(
    job: BaseJob<PrContext, ReviewerResult>,
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    const rawOutput = await this.extractAssistantOutput(sessionId, ctx);
    const result = parseReviewerOutput(rawOutput, job.key);
    const report = formatReviewerReport(result);

    job.completedAt = new Date();
    job.result = result;

    await this.deliverResults(result, report, job, ctx, config);
  }

  private async deliverResults(
    result: ReviewerResult,
    report: string,
    job: BaseJob<PrContext, ReviewerResult>,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    const delivery = config.delivery.reviewer;

    if (delivery.toast) {
      await deliverReviewerToast(ctx, result);
    }

    if (delivery.sessionMessage && job.parentSessionId && !result.clean) {
      await deliverReviewerToSession(
        ctx,
        job.parentSessionId,
        report,
        delivery.noReply,
      );
    }

    if (delivery.reportFile) {
      await deliverReviewerToFile(
        result,
        report,
        delivery.reportDir,
        ctx.directory,
      );
    }

    if (
      delivery.prComment &&
      config.pr.postWithGh &&
      this.postGhReview &&
      typeof job.context.number === 'number'
    ) {
      const posted = await this.postGhReview(job.context.number, report);
      if (posted) {
        log(
          `[reviewer-orchestrator] posted GH review for PR #${job.context.number}`,
        );
      }
    }
  }
}
