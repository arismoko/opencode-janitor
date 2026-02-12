import type { AgentPermissionPolicy, AgentRuntimePolicy } from './types';

export const DEFAULT_REVIEW_AGENT_PERMISSIONS: AgentPermissionPolicy = {
  '*': 'deny',
  glob: 'allow',
  grep: 'allow',
  list: 'allow',
  read: 'allow',
  lsp: 'allow',
};

export const DEFAULT_REVIEW_AGENT_MAX_STEPS = 2;

export const DEFAULT_REVIEW_AGENT_RUNTIME: AgentRuntimePolicy = {
  permission: DEFAULT_REVIEW_AGENT_PERMISSIONS,
  maxSteps: DEFAULT_REVIEW_AGENT_MAX_STEPS,
};

export function buildReviewAgentRuntime(
  overrides: Partial<AgentRuntimePolicy> = {},
): AgentRuntimePolicy {
  return {
    permission: {
      ...DEFAULT_REVIEW_AGENT_PERMISSIONS,
      ...(overrides.permission ?? {}),
    },
    maxSteps: overrides.maxSteps ?? DEFAULT_REVIEW_AGENT_MAX_STEPS,
  };
}
