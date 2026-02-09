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
import { ScribeOutput as ScribeOutputSchema } from '../../schemas/finding';
import type { ScribeResult } from '../../types';
import { log } from '../../utils/logger';
import type { BaseJob, ReviewStrategy } from '../review-run-queue';

export class ScribeStrategy implements ReviewStrategy<string, ScribeResult> {
  /**
   * Create the scribe agent runtime spec.
   *
   * Scribe is manual-trigger and repo-wide. Its context key is a
   * simple run identifier (e.g. `scribe:<timestamp>`). It produces
   * a ReviewContext with no diff — the agent explores docs and code
   * using tools, starting from a markdown inventory injected as metadata.
   */
  static createSpec(): AgentRuntimeSpec<string> {
    return {
      agent: 'scribe',
      queueTag: 'scribe',
      configKey: 'scribe',
      resolveModelId: (config) =>
        config.agents.scribe.modelId ?? config.model.id,

      async prepareReviewContext(
        runKey: string,
        _config: JanitorConfig,
        exec: Exec,
      ): Promise<PreparedContext> {
        // Build a markdown file inventory with last-modified timestamps.
        // This gives the scribe agent a prioritization signal for staleness.
        const docIndex = await buildDocIndex(exec);

        return {
          reviewContext: {
            label: runKey,
            metadata: [
              'Mode: documentation accuracy audit',
              'Use your tools (glob, grep, read, lsp) to verify doc claims against code.',
              '',
              '## Documentation Inventory',
              docIndex || '(No markdown files found in repository)',
            ],
          },
        };
      },

      sessionTitle: (runKey) => `[scribe-run] ${runKey}`,
    };
  }

  extractKey(runKey: string): string {
    return runKey;
  }

  errorLabel(key: string): string {
    return `scribe run \`${key}\``;
  }

  async onJobCompleted(
    job: BaseJob<string, ScribeResult>,
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
    extractAssistantOutput: (
      sessionId: string,
      ctx: PluginInput,
    ) => Promise<string>,
  ): Promise<void> {
    const rawOutput = await extractAssistantOutput(sessionId, ctx);
    const { output, meta } = parseAgentOutput(rawOutput, ScribeOutputSchema);
    if (meta.status !== 'ok') {
      throw new Error(`Scribe parse failed (${meta.status}): ${meta.error}`);
    }

    const result: ScribeResult = {
      id: job.key,
      findings: output.findings.map((f) => ({
        location: f.location,
        severity: f.severity,
        domain: f.domain as ScribeResult['findings'][0]['domain'],
        evidence: f.evidence,
        prescription: f.prescription,
      })),
      clean: output.findings.length === 0,
      raw: rawOutput,
    };

    const shortId = job.key.slice(0, 20);
    const report = renderReport(result.findings, result.clean, {
      title: 'Scribe Report',
      shortId,
      findingLabel: 'issue',
      showSeverityDomain: true,
    });

    job.completedAt = new Date();
    job.result = result;

    await this.deliverResults(result, report, shortId, job, ctx, config);
  }

  private async deliverResults(
    result: ScribeResult,
    report: string,
    shortId: string,
    job: BaseJob<string, ScribeResult>,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    // Scribe uses top-level delivery config (same as janitor).
    // A dedicated delivery.scribe can be added later if needed.
    const delivery = config.delivery;

    if (delivery.toast) {
      await deliverToast(ctx, result, { label: 'Scribe', shortId });
    }

    if (delivery.sessionMessage && job.parentSessionId && !result.clean) {
      await deliverToSession(ctx, job.parentSessionId, report, {
        label: 'Scribe Review Complete',
        noReply: delivery.noReply,
      });
    }

    if (delivery.reportFile) {
      await deliverToFile(report, {
        fileId: shortId,
        reportDir: '.janitor/scribe-reports',
        workspaceDir: ctx.directory,
      });
    }

    log(
      `[scribe-strategy] delivered results: ${result.findings.length} findings`,
    );
  }
}

// ---------------------------------------------------------------------------
// Doc-index helper
// ---------------------------------------------------------------------------

/**
 * Build a markdown file inventory with last-modified timestamps.
 *
 * Returns a formatted table string listing all .md files in the repo
 * with their last commit date. This gives the scribe agent a staleness
 * signal for prioritizing which docs to verify against code.
 *
 * Note: exec() pins `git` commands with `-C <workspace>`, but only the
 * first `git` in a shell pipeline gets pinned. We avoid pipelines by
 * running discrete git commands and iterating in JS.
 */
async function buildDocIndex(exec: Exec): Promise<string> {
  try {
    const raw = await exec('git ls-files "*.md"');
    const files = raw.trim().split('\n').filter(Boolean);

    if (files.length === 0) return '';

    // Fetch last-modified date for each file individually
    const lines: string[] = [];
    for (const file of files) {
      try {
        const date = (
          await exec(`git log -1 --format=%cs -- "${file}"`)
        ).trim();
        lines.push(`${date || 'unknown'}\t${file}`);
      } catch {
        lines.push(`unknown\t${file}`);
      }
    }

    // Sort by date ascending (oldest first — most likely stale)
    lines.sort();

    const header = '| Last Modified | File |';
    const sep = '|---|---|';
    const rows = lines.map((line) => {
      const [date, ...rest] = line.split('\t');
      const file = rest.join('\t');
      return `| ${date} | \`${file}\` |`;
    });

    return [header, sep, ...rows].join('\n');
  } catch {
    log('[scribe-strategy] failed to build doc index, continuing without');
    return '';
  }
}
