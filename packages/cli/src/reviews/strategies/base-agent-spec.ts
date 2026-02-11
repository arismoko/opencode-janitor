import {
  AGENTS,
  type AgentName,
  type AgentProfile,
  buildReviewPrompt,
  type CommitContext,
  parseAgentOutput,
} from '@opencode-janitor/shared';
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

type BaseAgentSpecMethods = Pick<
  AgentRuntimeSpec,
  | 'supportsTrigger'
  | 'maxFindings'
  | 'modelId'
  | 'variant'
  | 'buildPrompt'
  | 'parseOutput'
  | 'onSuccess'
>;

export function buildPromptConfig(agentName: AgentName, config: CliConfig) {
  return {
    scopeInclude: config.scope.include,
    scopeExclude: config.scope.exclude,
    maxFindings: config.agents[agentName].maxFindings,
  };
}

export function buildCommitPreparedContext(
  agentName: AgentName,
  config: CliConfig,
  sha: string,
  context: CommitContext,
  options?: {
    label?: string;
    metadataPrefix?: string[];
    metadataSuffix?: string[];
  },
): PreparedAgentContext {
  const metadata = [
    ...(options?.metadataPrefix ?? []),
    `SHA: ${sha}`,
    `Subject: ${context.subject}`,
    `Parents: ${context.parents.join(' ') || '-'}`,
    ...(options?.metadataSuffix ?? []),
  ];

  return {
    reviewContext: {
      mode: 'diff',
      label: options?.label ?? `${sha.slice(0, 8)} - ${context.subject}`,
      changedFiles: context.changedFiles,
      patch: context.patch,
      patchTruncated: context.patchTruncated,
      metadata,
    },
    promptConfig: buildPromptConfig(agentName, config),
  };
}

export function buildRepoPreparedContext(
  agentName: AgentName,
  config: CliConfig,
  options: {
    label: string;
    metadata: string[];
    reason?: 'manual-repo' | 'empty-workspace-fallback';
  },
): PreparedAgentContext {
  return {
    reviewContext: {
      mode: 'repo',
      label: options.label,
      metadata: options.metadata,
      ...(options.reason ? { reason: options.reason } : {}),
    },
    promptConfig: buildPromptConfig(agentName, config),
  };
}

function hasWorkspaceDiff(context: CommitContext): boolean {
  return context.changedFiles.length > 0 || context.patch.trim().length > 0;
}

export function buildManualWorkspaceOrRepoPreparedContext(
  agentName: AgentName,
  config: CliConfig,
  sha: string,
  context: CommitContext,
  options?: {
    workspaceLabel?: string;
    repoFallbackLabel?: string;
  },
): PreparedAgentContext {
  if (hasWorkspaceDiff(context)) {
    return buildCommitPreparedContext(agentName, config, sha, context, {
      label: options?.workspaceLabel ?? 'Manual workspace review',
      metadataPrefix: [
        'Trigger: manual',
        'Mode: staged + unstaged workspace changes',
      ],
    });
  }

  return buildRepoPreparedContext(agentName, config, {
    label: options?.repoFallbackLabel ?? 'Manual repo-wide analysis',
    metadata: [
      'Trigger: manual',
      'Mode: repo-wide fallback (workspace has no local changes)',
    ],
    reason: 'empty-workspace-fallback',
  });
}

export function createBaseAgentSpec(
  agentName: AgentName,
  profile: AgentProfile,
): BaseAgentSpecMethods {
  return {
    supportsTrigger(config: CliConfig, kind: ReviewTriggerKind): boolean {
      const agentConfig = config.agents[agentName];
      if (!agentConfig.enabled) return false;

      if (kind === 'manual') {
        return true;
      }

      const supportedByAgent = AGENTS[agentName].capabilities.autoTriggers;
      return (
        agentConfig.autoTriggers.includes(kind) &&
        supportedByAgent.includes(kind)
      );
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

    buildPrompt(input: BuildPromptInput): string {
      return buildReviewPrompt(
        input.preparedContext.reviewContext,
        input.preparedContext.promptConfig,
      );
    },

    parseOutput(rawOutput: string): ParsedAgentOutput {
      const parsed = parseAgentOutput(rawOutput, agentName);

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

export function createAgentSpecFactory(
  profile: AgentProfile,
  prepareContextBuilder: (
    input: PrepareContextInput,
    agentName: AgentName,
  ) => PreparedAgentContext,
): AgentRuntimeSpec {
  const agentName = profile.name;
  const base = createBaseAgentSpec(agentName, profile);

  return {
    agent: agentName,
    profile,
    configKey: agentName,
    ...base,

    prepareContext(input: PrepareContextInput): PreparedAgentContext {
      return prepareContextBuilder(input, agentName);
    },
  };
}
