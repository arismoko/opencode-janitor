import type { AgentDefinition } from './types';

export function defineAgent<
  const TAgentId extends string,
  const TTriggerId extends string,
  const TScopeId extends string,
>(
  definition: AgentDefinition<TAgentId, TTriggerId, TScopeId>,
): AgentDefinition<TAgentId, TTriggerId, TScopeId> {
  return definition;
}
