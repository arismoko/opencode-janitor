import {
  AGENTS,
  type AgentId,
  type ReviewContext,
  type ScopeId,
  type TriggerContext,
  type TriggerId,
} from '@opencode-janitor/shared';

export interface BuildReviewRunContextInput {
  agent: AgentId;
  trigger: TriggerId;
  scope: ScopeId;
  repoPath: string;
  defaultBranch: string;
  hasWorkspaceDiff: boolean;
  triggerContext: TriggerContext;
  reviewContext: ReviewContext;
}

export function buildReviewRunContext(
  input: BuildReviewRunContextInput,
): ReviewContext {
  const definition = AGENTS[input.agent];
  const enriched = definition.enrichContext({
    trigger: input.trigger,
    scope: input.scope,
    repoPath: input.repoPath,
    defaultBranch: input.defaultBranch,
    hasWorkspaceDiff: input.hasWorkspaceDiff,
    sha: input.triggerContext.sha,
    prNumber: input.triggerContext.prNumber,
  });

  const baseMetadata = input.reviewContext.metadata ?? [];
  const metadata = [
    ...(enriched.metadataPrefix ?? []),
    ...input.triggerContext.metadata,
    ...baseMetadata,
    ...(enriched.metadataSuffix ?? []),
  ];

  if (input.reviewContext.mode === 'repo') {
    return {
      ...input.reviewContext,
      label: enriched.label ?? input.reviewContext.label,
      metadata,
      reason: enriched.reason ?? input.reviewContext.reason,
      trigger: input.trigger,
      scope: input.scope,
      subject: input.triggerContext.subject,
    };
  }

  return {
    ...input.reviewContext,
    label: enriched.label ?? input.reviewContext.label,
    metadata,
    trigger: input.trigger,
    scope: input.scope,
    subject: input.triggerContext.subject,
  };
}
