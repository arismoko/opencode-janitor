import type { z } from 'zod';

export type AgentContextReason = 'manual-repo' | 'empty-workspace-fallback';

export type AgentContextMeta = {
  label?: string;
  metadataPrefix?: string[];
  metadataSuffix?: string[];
  reason?: AgentContextReason;
};

export type ResolveManualScopeInput<TScopeId extends string = string> = {
  requestedScope?: TScopeId;
  hasWorkspaceDiff: boolean;
  manualInput?: Record<string, unknown>;
  trigger: 'manual';
};

export type EnrichContextInput<
  TTriggerId extends string = string,
  TScopeId extends string = string,
> = {
  trigger: TTriggerId;
  scope: TScopeId;
  repoPath: string;
  defaultBranch: string;
  hasWorkspaceDiff: boolean;
  sha?: string;
  prNumber?: number;
};

export type AgentDefinition<
  TAgentId extends string = string,
  TTriggerId extends string = string,
  TScopeId extends string = string,
> = {
  id: TAgentId;
  label: string;
  description: string;
  role: string;
  domains: readonly string[];
  rules?: string;
  outputSchema: z.ZodTypeAny;
  defaults: {
    autoTriggers: readonly TTriggerId[];
    manualScope?: TScopeId;
    maxFindings?: number;
  };
  capabilities: {
    autoTriggers: readonly TTriggerId[];
    manualScopes: readonly TScopeId[];
  };
  cli: {
    command: string;
    alias?: string;
    description: string;
  };
  resolveManualScope: (input: ResolveManualScopeInput<TScopeId>) => TScopeId;
  enrichContext: (
    input: EnrichContextInput<TTriggerId, TScopeId>,
  ) => AgentContextMeta;
  reviewPromptHints?: (
    input: EnrichContextInput<TTriggerId, TScopeId>,
  ) => string[];
};
