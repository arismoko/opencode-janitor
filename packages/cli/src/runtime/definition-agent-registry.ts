import {
  AGENT_IDS,
  type AgentId,
  type TriggerContext,
} from '@opencode-janitor/shared';
import {
  type AgentRuntimeRegistry,
  createAgentRuntimeRegistry,
} from './agent-runtime-registry';
import type {
  PrepareContextInput,
  PreparedAgentContext,
} from './agent-runtime-spec';
import { createAgentSpecFromDefinition } from './agent-spec-from-definition';
import { buildReviewRunContext } from './review-run-context';

function buildTriggerMetadata(input: PrepareContextInput): string[] {
  const metadata = [
    `SHA: ${input.trigger.commitSha}`,
    `Subject: ${input.trigger.commitContext.subject}`,
    `Parents: ${input.trigger.commitContext.parents.join(' ') || '-'}`,
  ];
  if (input.trigger.kind === 'pr') {
    metadata.unshift(`PR: #${input.trigger.prNumber}`);
  }
  return metadata;
}

function toSharedTriggerContext(input: PrepareContextInput): TriggerContext {
  return {
    trigger: input.trigger.kind,
    subject: input.trigger.commitContext.subject,
    metadata: buildTriggerMetadata(input),
    sha: input.trigger.commitSha,
    ...(input.trigger.kind === 'pr'
      ? { prNumber: input.trigger.prNumber }
      : {}),
  };
}

function buildPreparedContext(
  input: PrepareContextInput,
  agent: AgentId,
): PreparedAgentContext {
  const scope = input.run.scope;
  const hasWorkspaceDiff =
    input.trigger.commitContext.changedFiles.length > 0 ||
    input.trigger.commitContext.patch.trim().length > 0;
  const promptConfig = {
    scopeInclude: input.config.scope.include,
    scopeExclude: input.config.scope.exclude,
    maxFindings: input.config.agents[agent].maxFindings,
  };

  if (scope === 'repo') {
    const reviewContext = buildReviewRunContext({
      agent,
      trigger: input.trigger.kind,
      scope,
      repoPath: input.run.path,
      defaultBranch: input.run.default_branch,
      hasWorkspaceDiff,
      triggerContext: toSharedTriggerContext(input),
      reviewContext: {
        mode: 'repo',
        label: 'Manual repo-wide analysis',
        metadata: ['Trigger: manual', 'Mode: full codebase inspection'],
      },
    });

    return {
      reviewContext,
      promptConfig,
    };
  }

  const reviewContext = buildReviewRunContext({
    agent,
    trigger: input.trigger.kind,
    scope,
    repoPath: input.run.path,
    defaultBranch: input.run.default_branch,
    hasWorkspaceDiff,
    triggerContext: toSharedTriggerContext(input),
    reviewContext: {
      mode: 'diff',
      label:
        scope === 'pr' && input.trigger.kind === 'pr'
          ? `PR #${input.trigger.prNumber} @ ${input.trigger.commitSha.slice(0, 8)}`
          : `${input.trigger.commitSha.slice(0, 8)} - ${input.trigger.commitContext.subject}`,
      changedFiles: input.trigger.commitContext.changedFiles,
      patch: input.trigger.commitContext.patch,
      patchTruncated: input.trigger.commitContext.patchTruncated,
      metadata: buildTriggerMetadata(input),
    },
  });

  return {
    reviewContext,
    promptConfig,
  };
}

export function createDefinitionAgentRegistry(): AgentRuntimeRegistry {
  const registry = createAgentRuntimeRegistry();
  for (const agent of AGENT_IDS) {
    registry.register(
      createAgentSpecFromDefinition({
        agent,
        buildPreparedContext: (input) => buildPreparedContext(input, agent),
      }),
    );
  }
  return registry;
}
