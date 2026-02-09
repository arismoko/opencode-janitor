import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import type { PrContext } from '../git/pr-context-resolver';
import { parseAgentOutput } from '../results/agent-output-codec';
import { renderReport } from '../results/report-renderer';
import { deliverToFile } from '../results/sinks/file-sink';
import { deliverToSession } from '../results/sinks/session-sink';
import { deliverToast } from '../results/sinks/toast-sink';
import { HunterOutput as HunterOutputSchema } from '../schemas/finding';
import type { ReviewerResult } from '../types';
import { log } from '../utils/logger';
import { extractWorkspaceHeadFromKey } from '../utils/review-key';
import { type BaseJob, BaseOrchestrator } from './base-orchestrator';

type ReviewerExecutor = (context: PrContext) => Promise<string>;

type GhPostReview = (prNumber: number, body: string) => Promise<boolean>;

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
  private onReviewCompleted?: (key: string) => void;

  constructor(
    config: JanitorConfig,
    executor: ReviewerExecutor,
    private readonly postGhReview?: GhPostReview,
  ) {
    super(config, executor, 'reviewer-orchestrator');
  }

  /** Register a callback invoked when a reviewer run completes successfully. */
  onCompleted(callback: (key: string) => void): void {
    this.onReviewCompleted = callback;
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
    const resultId = extractWorkspaceHeadFromKey(job.key);
    const { output, meta } = parseAgentOutput(rawOutput, HunterOutputSchema);
    if (meta.status !== 'ok') {
      throw new Error(`Reviewer parse failed (${meta.status}): ${meta.error}`);
    }
    const result: ReviewerResult = {
      id: resultId,
      findings: output.findings.map((f) => ({
        location: f.location,
        severity: f.severity,
        domain: f.domain as ReviewerResult['findings'][0]['domain'],
        evidence: f.evidence,
        prescription: f.prescription,
      })),
      clean: output.findings.length === 0,
      raw: rawOutput,
    };
    const shortId = resultId.slice(0, 12);
    const report = renderReport(result.findings, result.clean, {
      title: 'Reviewer Report',
      shortId,
      findingLabel: 'issue',
      showSeverityDomain: true,
    });

    job.completedAt = new Date();
    job.result = result;

    await this.deliverResults(result, report, shortId, job, ctx, config);

    // Persist key only after successful extraction + delivery
    this.onReviewCompleted?.(job.key);
  }

  private async deliverResults(
    result: ReviewerResult,
    report: string,
    shortId: string,
    job: BaseJob<PrContext, ReviewerResult>,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    const delivery = config.delivery.reviewer;

    if (delivery.toast) {
      await deliverToast(ctx, result, {
        label: 'Code Review',
        shortId,
      });
    }

    if (delivery.sessionMessage && job.deliverySessionId && !result.clean) {
      // Skip session injection when a PR comment will be posted —
      // the PR comment is the primary delivery channel in that case.
      const willPostPr =
        delivery.prComment &&
        config.pr.postWithGh &&
        this.postGhReview &&
        typeof job.context.number === 'number';

      if (!willPostPr) {
        await deliverToSession(ctx, job.deliverySessionId, report, {
          label: 'Code Review Complete',
          noReply: delivery.noReply,
        });
      }
    }

    if (delivery.reportFile) {
      await deliverToFile(report, {
        fileId: shortId,
        reportDir: delivery.reportDir,
        workspaceDir: ctx.directory,
      });
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
