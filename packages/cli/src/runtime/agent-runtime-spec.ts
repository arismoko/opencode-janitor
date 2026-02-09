/**
 * Agent runtime spec — captures per-agent differences as data.
 *
 * Each spec encodes trigger support, config resolution, and review context
 * building, eliminating branching in the scheduler worker.
 */

import type {
  AgentName,
  AgentProfile,
  CommitContext,
  PromptConfig,
  ReviewContext,
} from '@opencode-janitor/shared';
import { buildReviewPrompt, parseAgentOutput } from '@opencode-janitor/shared';
import type { z } from 'zod';
import type { CliConfig } from '../config/schema';
import type { FindingRow, QueuedJobRow } from '../db/models';

export type ReviewTriggerKind = 'commit' | 'pr' | 'manual';

export interface ParsedFinding {
  severity: string;
  domain: string;
  location: string;
  evidence: string;
  prescription: string;
}

export interface ParsedAgentOutput {
  findings: ParsedFinding[];
}

export interface PrepareContextInput {
  config: CliConfig;
  job: QueuedJobRow;
  triggerKind: ReviewTriggerKind;
  commitSha: string;
  commitContext: CommitContext;
}

export interface PreparedAgentContext {
  reviewContext: ReviewContext;
  promptConfig: PromptConfig;
}

export interface BuildPromptInput {
  preparedContext: PreparedAgentContext;
}

export interface SuccessInput {
  job: QueuedJobRow;
  runId: string;
  output: ParsedAgentOutput;
}

export type PersistableFindingRow = Omit<FindingRow, 'id' | 'created_at'>;

// ---------------------------------------------------------------------------
// Runtime spec interface
// ---------------------------------------------------------------------------

export interface AgentRuntimeSpec {
  /** Agent identifier (janitor/hunter/inspector/scribe) */
  agent: AgentName;

  /** Shared profile for this agent */
  profile: AgentProfile;

  /** Key into config.agents */
  configKey: AgentName;

  /** Whether this spec can handle the given trigger kind. */
  supportsTrigger(config: CliConfig, kind: 'commit' | 'pr' | 'manual'): boolean;

  /** Maximum findings from config. */
  maxFindings(config: CliConfig): number;

  /** Resolved model ID (provider/model format). */
  modelId(config: CliConfig): string;

  /** Variant from config. */
  variant(config: CliConfig): string | undefined;

  /** Build execution context (review context + prompt config). */
  prepareContext(input: PrepareContextInput): PreparedAgentContext;

  /** Build the final user prompt from prepared context. */
  buildPrompt(input: BuildPromptInput): string;

  /** Parse raw assistant output into typed findings. Throws on invalid output. */
  parseOutput(rawOutput: string): ParsedAgentOutput;

  /** Map parsed output into DB finding rows for successful runs. */
  onSuccess(input: SuccessInput): PersistableFindingRow[];
}

// ---------------------------------------------------------------------------
// Default spec builder
// ---------------------------------------------------------------------------

/** Create a standard runtime spec for an agent. */
export function createAgentRuntimeSpec(
  profile: AgentProfile,
): AgentRuntimeSpec {
  const agentName = profile.name;

  return {
    agent: agentName,
    profile,
    configKey: agentName,

    supportsTrigger(
      config: CliConfig,
      kind: 'commit' | 'pr' | 'manual',
    ): boolean {
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
      const { config, commitSha, commitContext } = input;

      return {
        reviewContext: {
          label: `${commitSha.slice(0, 8)} - ${commitContext.subject}`,
          changedFiles: commitContext.changedFiles,
          patch: commitContext.patch,
          patchTruncated: commitContext.patchTruncated,
          metadata: [
            `SHA: ${commitSha}`,
            `Subject: ${commitContext.subject}`,
            `Parents: ${commitContext.parents.join(' ')}`,
          ],
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
