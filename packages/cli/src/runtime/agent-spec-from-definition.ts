import {
  AGENTS,
  type AgentId,
  buildReviewPrompt,
  type PromptConfig,
  parseAgentOutput,
  type ReviewContext,
  toAgentProfile,
} from '@opencode-janitor/shared';
import { canAgentRunForTrigger } from './agent-eligibility-policy';
import type {
  AgentRuntimeSpec,
  BuildPromptInput,
  ParsedAgentOutput,
  PersistableFindingRow,
  PrepareContextInput,
  PreparedAgentContext,
  SuccessInput,
} from './agent-runtime-spec';

export interface AgentSpecFromDefinitionOptions {
  agent: AgentId;
  buildPreparedContext: (input: PrepareContextInput) => PreparedAgentContext;
}

function buildPromptConfig(
  input: PrepareContextInput,
  agent: AgentId,
): Pick<PromptConfig, 'promptHints'> {
  const definition = AGENTS[agent];
  return {
    promptHints: definition.reviewPromptHints
      ? definition.reviewPromptHints({
          trigger: input.trigger.kind,
          scope: input.run.scope,
          repoPath: input.run.path,
          defaultBranch: input.run.default_branch,
          hasWorkspaceDiff:
            input.trigger.commitContext.changedFiles.length > 0 ||
            input.trigger.commitContext.patch.trim().length > 0,
          sha: input.trigger.commitSha,
          prNumber:
            input.trigger.kind === 'pr' ? input.trigger.prNumber : undefined,
        })
      : undefined,
  };
}

export function createAgentSpecFromDefinition(
  options: AgentSpecFromDefinitionOptions,
): AgentRuntimeSpec {
  const definition = AGENTS[options.agent];

  return {
    agent: definition.id,
    profile: toAgentProfile(definition.id),
    configKey: definition.id,
    supportsTrigger(config, kind) {
      return canAgentRunForTrigger(config, definition.id, kind).eligible;
    },
    maxFindings(config) {
      return config.agents[definition.id].maxFindings;
    },
    modelId(config) {
      return (
        config.agents[definition.id].modelId ?? config.opencode.defaultModelId
      );
    },
    variant(config) {
      return config.agents[definition.id].variant;
    },
    prepareContext(input) {
      const prepared = options.buildPreparedContext(input);
      const reviewContext: ReviewContext = {
        ...prepared.reviewContext,
        trigger: input.trigger.kind,
      };
      return {
        reviewContext,
        promptConfig: {
          ...buildPromptConfig(input, definition.id),
          ...prepared.promptConfig,
        },
      };
    },
    buildPrompt(input: BuildPromptInput) {
      return buildReviewPrompt(
        input.preparedContext.reviewContext,
        input.preparedContext.promptConfig,
      );
    },
    parseOutput(rawOutput: string): ParsedAgentOutput {
      const parsed = parseAgentOutput(rawOutput, definition.id);
      if (parsed.meta.status !== 'ok') {
        throw new Error(
          `agent output parse failed (${parsed.meta.status}): ${parsed.meta.error ?? 'unknown parse error'}`,
        );
      }
      return parsed.output as ParsedAgentOutput;
    },
    onSuccess(input: SuccessInput): PersistableFindingRow[] {
      return input.output.findings.map((finding) => ({
        details_json: (() => {
          const sections =
            definition.findingEnrichments?.buildSections?.(
              finding as Record<string, unknown>,
            ) ?? [];
          return sections.length > 0
            ? JSON.stringify({ enrichments: sections })
            : '{}';
        })(),
        repo_id: input.run.repo_id,
        agent: definition.id,
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
