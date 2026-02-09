/**
 * Scribe strategy — builds review context for the Scribe agent.
 *
 * The Scribe focuses on documentation drift, gaps, and release notes
 * (DRIFT, GAP, RELEASE). Enriches context with doc-file metadata
 * when documentation files appear in the changeset.
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
import { buildDocIndexMetadata } from './build-doc-index';

export function createScribeSpec(profile: AgentProfile): AgentRuntimeSpec {
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

      if (trigger.kind === 'manual' && !trigger.commitContext) {
        return {
          reviewContext: {
            label: 'Manual repo-wide documentation review',
            metadata: ['Trigger: manual', 'Mode: full documentation audit'],
          },
          promptConfig: {
            scopeInclude: config.scope.include,
            scopeExclude: config.scope.exclude,
            maxFindings: config.agents[agentName].maxFindings,
          },
        };
      }

      const sha =
        trigger.kind === 'manual' ? trigger.commitSha! : trigger.commitSha;
      const ctx =
        trigger.kind === 'manual'
          ? trigger.commitContext!
          : trigger.commitContext;

      const metadata = [
        `SHA: ${sha}`,
        `Subject: ${ctx.subject}`,
        `Parents: ${ctx.parents.join(' ')}`,
      ];

      const docMeta = buildDocIndexMetadata(
        ctx.changedFiles.map((f) => f.path),
      );
      if (docMeta) {
        metadata.push(docMeta);
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
