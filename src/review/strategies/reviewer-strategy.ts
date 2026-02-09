import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../../config/schema';
import type { PrContext } from '../../git/pr-context-resolver';
import { parseAgentOutput } from '../../results/agent-output-codec';
import { renderReport } from '../../results/report-renderer';
import { deliverToFile } from '../../results/sinks/file-sink';
import { deliverToSession } from '../../results/sinks/session-sink';
import { deliverToast } from '../../results/sinks/toast-sink';
import { HunterOutput as HunterOutputSchema } from '../../schemas/finding';
import type { ReviewerResult } from '../../types';
import { log } from '../../utils/logger';
import { extractWorkspaceHeadFromKey } from '../../utils/review-key';
import type { BaseJob, ReviewStrategy } from '../review-run-queue';

type GhPostReview = (prNumber: number, body: string) => Promise<boolean>;

export class ReviewerStrategy
  implements ReviewStrategy<PrContext, ReviewerResult>
{
  constructor(private readonly postGhReview?: GhPostReview) {}

  extractKey(context: PrContext): string {
    return context.key;
  }

  errorLabel(key: string): string {
    return `\`${key}\``;
  }

  async onJobCompleted(
    job: BaseJob<PrContext, ReviewerResult>,
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
    extractAssistantOutput: (
      sessionId: string,
      ctx: PluginInput,
    ) => Promise<string>,
  ): Promise<void> {
    const rawOutput = await extractAssistantOutput(sessionId, ctx);
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
      await deliverToast(ctx, result, { label: 'Code Review', shortId });
    }

    if (delivery.sessionMessage && job.deliverySessionId && !result.clean) {
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
          `[reviewer-strategy] posted GH review for PR #${job.context.number}`,
        );
      }
    }
  }
}
