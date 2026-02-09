import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../../config/schema';
import type { PrContext } from '../../git/pr-context-resolver';
import { parseAgentOutput } from '../../results/agent-output-codec';
import { renderReport } from '../../results/report-renderer';
import { deliverToFile } from '../../results/sinks/file-sink';
import { deliverToSession } from '../../results/sinks/session-sink';
import { deliverToast } from '../../results/sinks/toast-sink';
import type {
  AgentRuntimeSpec,
  PreparedContext,
} from '../../runtime/agent-runtime-spec';
import type { Exec } from '../../runtime/runtime-types';
import { HunterOutput as HunterOutputSchema } from '../../schemas/finding';
import type { HunterResult } from '../../types';
import { log } from '../../utils/logger';
import { extractWorkspaceHeadFromKey } from '../../utils/review-key';
import type { BaseJob, ReviewStrategy } from '../review-run-queue';

type GhPostReview = (prNumber: number, body: string) => Promise<boolean>;

export class HunterStrategy implements ReviewStrategy<PrContext, HunterResult> {
  constructor(private readonly postGhReview?: GhPostReview) {}

  /**
   * Create the hunter agent runtime spec.
   * Centralizes hunter-specific context resolution as strategy-owned data.
   */
  static createSpec(): AgentRuntimeSpec<PrContext> {
    return {
      agent: 'bug-hunter',
      queueTag: 'hunter',
      configKey: 'hunter',
      resolveModelId: (config) =>
        config.agents.hunter.modelId ?? config.model.id,

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

  extractKey(context: PrContext): string {
    return context.key;
  }

  errorLabel(key: string): string {
    return `\`${key}\``;
  }

  async onJobCompleted(
    job: BaseJob<PrContext, HunterResult>,
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
      throw new Error(`Hunter parse failed (${meta.status}): ${meta.error}`);
    }
    const result: HunterResult = {
      id: resultId,
      findings: output.findings.map((f) => ({
        location: f.location,
        severity: f.severity,
        domain: f.domain as HunterResult['findings'][0]['domain'],
        evidence: f.evidence,
        prescription: f.prescription,
      })),
      clean: output.findings.length === 0,
      raw: rawOutput,
    };
    const shortId = resultId.slice(0, 12);
    const report = renderReport(result.findings, result.clean, {
      title: 'Hunter Report',
      shortId,
      findingLabel: 'issue',
      showSeverityDomain: true,
    });

    job.completedAt = new Date();
    job.result = result;

    await this.deliverResults(result, report, shortId, job, ctx, config);
  }

  private async deliverResults(
    result: HunterResult,
    report: string,
    shortId: string,
    job: BaseJob<PrContext, HunterResult>,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    const delivery = config.delivery.hunter;

    if (delivery.toast) {
      await deliverToast(ctx, result, { label: 'Bug Hunt', shortId });
    }

    if (delivery.sessionMessage && job.parentSessionId && !result.clean) {
      const willPostPr =
        delivery.prComment &&
        config.pr.postWithGh &&
        this.postGhReview &&
        typeof job.context.number === 'number';

      if (!willPostPr) {
        await deliverToSession(ctx, job.parentSessionId, report, {
          label: 'Bug Hunt Complete',
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
        log(`[hunter-strategy] posted GH review for PR #${job.context.number}`);
      }
    }
  }
}
