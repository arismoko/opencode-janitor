/**
 * Janitor strategy — builds review context for the Janitor agent.
 *
 * The Janitor focuses on structural cleanup (YAGNI, DRY, DEAD).
 * It requires a commit diff to analyse changes.
 */

import {
  type AgentProfile,
  buildReviewPrompt,
  parseAgentOutput,
} from '@opencode-janitor/shared';
import type { z } from 'zod';
import type { CliConfig } from '../../config/schema';
import type {
  AgentRuntimeSpec,
  BuildPromptInput,
  ParsedAgentOutput,
  PersistableFindingRow,
  PrepareContextInput,
  PreparedAgentContext,
  ReviewTriggerKind,
  SuccessInput,
} from '../../runtime/agent-runtime-spec';

export function createJanitorSpec(profile: AgentProfile): AgentRuntimeSpec {
  const agentName = profile.name;

  return {
    agent: agentName,
    profile,
    configKey: agentName,

    supportsTrigger(config: CliConfig, kind: ReviewTriggerKind): boolean {
      const agentConfig = config.agents[agentName];
      if (!agentConfig.enabled) return false;

      const trigger = agentConfig.trigger;
      if (trigger === 'never') return false;
      if (trigger === 'both') return kind === 'commit' || kind === 'pr';
      if (trigger === 'manual') return kind === 'manual';
      return trigger === kind;
    },

    maxFindings(config: CliConfig): number {
      return config.agents[agentName].maxFindings;
    },

    modelId(config: CliConfig): string {
      return config.agents[agentName].modelId ?? config.opencode.defaultModelId;
    },

    variant(config: CliConfig): string | undefined {
      return config.agents[agentName].variant;
    },

    prepareContext(input: PrepareContextInput): PreparedAgentContext {
      const { config, trigger } = input;

      const sha = trigger.commitSha;
      const ctx = trigger.commitContext;

      const metadata = [
        `SHA: ${sha}`,
        `Subject: ${ctx.subject}`,
        `Parents: ${ctx.parents.join(' ') || '-'}`,
      ];
      if (trigger.kind === 'manual') {
        metadata.unshift(
          'Trigger: manual',
          'Mode: staged + unstaged workspace changes',
        );
      }

      return {
        reviewContext: {
          label: `${sha.slice(0, 8)} - ${ctx.subject}`,
          changedFiles: ctx.changedFiles,
          patch: ctx.patch,
          patchTruncated: ctx.patchTruncated,
          metadata,
        },
        promptConfig: {
          scopeInclude: config.scope.include,
          scopeExclude: config.scope.exclude,
          maxFindings: config.agents[agentName].maxFindings,
        },
      };
    },

    buildPrompt(input: BuildPromptInput): string {
      return buildReviewPrompt(
        input.preparedContext.reviewContext,
        input.preparedContext.promptConfig,
      );
    },

    parseOutput(rawOutput: string): ParsedAgentOutput {
      const schema = profile.outputSchema as z.ZodType<ParsedAgentOutput>;
      const parsed = parseAgentOutput(rawOutput, schema);

      if (parsed.meta.status !== 'ok') {
        throw new Error(
          `agent output parse failed (${parsed.meta.status}): ${parsed.meta.error ?? 'unknown parse error'}`,
        );
      }

      return parsed.output;
    },

    onSuccess(input: SuccessInput): PersistableFindingRow[] {
      return input.output.findings.map((finding) => ({
        repo_id: input.job.repo_id,
        job_id: input.job.id,
        agent_run_id: input.runId,
        agent: agentName,
        severity: finding.severity,
        domain: finding.domain,
        location: finding.location,
        evidence: finding.evidence,
        prescription: finding.prescription,
        fingerprint: `${finding.domain}:${finding.location}:${finding.severity}`,
      }));
    },
  };
}
