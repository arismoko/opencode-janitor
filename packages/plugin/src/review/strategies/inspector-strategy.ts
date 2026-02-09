import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../../config/schema';
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
import { InspectorOutput as InspectorOutputSchema } from '../../schemas/finding';
import type { InspectorResult } from '../../types';
import { log } from '../../utils/logger';
import type { BaseJob, ReviewStrategy } from '../review-run-queue';

export class InspectorStrategy
  implements ReviewStrategy<string, InspectorResult>
{
  /**
   * Create the inspector agent runtime spec.
   *
   * Inspector is manual-trigger and repo-wide. Its context key is a
   * simple run identifier (e.g. `inspector:<timestamp>`). It produces
   * a ReviewContext with no diff — the agent explores the repo using tools.
   */
  static createSpec(): AgentRuntimeSpec<string> {
    return {
      agent: 'inspector',
      queueTag: 'inspector',
      configKey: 'inspector',
      resolveModelId: (config) =>
        config.agents.inspector.modelId ?? config.model.id,

      async prepareReviewContext(
        runKey: string,
        _config: JanitorConfig,
        _exec: Exec,
      ): Promise<PreparedContext> {
        // Inspector runs repo-wide without a diff. The prompt builder
        // handles absent changedFiles/patch gracefully.
        return {
          reviewContext: {
            label: runKey,
            metadata: [
              'Mode: repo-wide architectural analysis',
              'Use your tools (glob, grep, read, lsp) to explore the codebase.',
            ],
          },
        };
      },

      sessionTitle: (runKey) => `[inspector-run] ${runKey}`,
    };
  }

  extractKey(runKey: string): string {
    return runKey;
  }

  errorLabel(key: string): string {
    return `inspector run \`${key}\``;
  }

  async onJobCompleted(
    job: BaseJob<string, InspectorResult>,
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
    extractAssistantOutput: (
      sessionId: string,
      ctx: PluginInput,
    ) => Promise<string>,
  ): Promise<void> {
    const rawOutput = await extractAssistantOutput(sessionId, ctx);
    const { output, meta } = parseAgentOutput(rawOutput, InspectorOutputSchema);
    if (meta.status !== 'ok') {
      throw new Error(`Inspector parse failed (${meta.status}): ${meta.error}`);
    }

    const result: InspectorResult = {
      id: job.key,
      findings: output.findings.map((f) => ({
        location: f.location,
        severity: f.severity,
        domain: f.domain as InspectorResult['findings'][0]['domain'],
        evidence: f.evidence,
        prescription: f.prescription,
      })),
      clean: output.findings.length === 0,
      raw: rawOutput,
    };

    const shortId = job.key.slice(0, 20);
    const report = renderReport(result.findings, result.clean, {
      title: 'Inspector Report',
      shortId,
      findingLabel: 'issue',
      showSeverityDomain: true,
    });

    job.completedAt = new Date();
    job.result = result;

    await this.deliverResults(result, report, shortId, job, ctx, config);
  }

  private async deliverResults(
    result: InspectorResult,
    report: string,
    shortId: string,
    job: BaseJob<string, InspectorResult>,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    // Inspector uses top-level delivery config (same as janitor).
    // A dedicated delivery.inspector can be added later if needed.
    const delivery = config.delivery;

    if (delivery.toast) {
      await deliverToast(ctx, result, { label: 'Inspector', shortId });
    }

    if (delivery.sessionMessage && job.parentSessionId && !result.clean) {
      await deliverToSession(ctx, job.parentSessionId, report, {
        label: 'Inspector Review Complete',
        noReply: delivery.noReply,
      });
    }

    // File report is always written as a durable fallback
    await deliverToFile(report, {
      fileId: shortId,
      reportDir: '.janitor/inspector-reports',
      workspaceDir: ctx.directory,
    });

    log(
      `[inspector-strategy] delivered results: ${result.findings.length} findings`,
    );
  }
}
