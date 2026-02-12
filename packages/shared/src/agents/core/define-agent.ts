import type { z } from 'zod';
import type { AgentDefinition } from './types';

export function defineAgent<
  const TAgentId extends string,
  const TTriggerId extends string,
  const TScopeId extends string,
  const TOutputSchema extends z.ZodTypeAny,
>(
  definition: AgentDefinition<TAgentId, TTriggerId, TScopeId, TOutputSchema>,
): AgentDefinition<TAgentId, TTriggerId, TScopeId, TOutputSchema> {
  return definition;
}
