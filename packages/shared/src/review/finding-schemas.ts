import type { z } from 'zod';
import { AGENT_IDS, AGENTS, type AgentId } from '../agents';
import { BaseFinding, Severity } from '../agents/core/schema-core';

export { BaseFinding, Severity };

export const OUTPUT_SCHEMAS = Object.fromEntries(
  AGENT_IDS.map((agentId) => [agentId, AGENTS[agentId].outputSchema]),
) as { [K in AgentId]: (typeof AGENTS)[K]['outputSchema'] };

export type AgentOutput<TAgent extends AgentId> = z.infer<
  (typeof OUTPUT_SCHEMAS)[TAgent]
>;

export type FindingByAgent<TAgent extends AgentId> =
  AgentOutput<TAgent>['findings'][number];

export type AnyFinding = { [K in AgentId]: FindingByAgent<K> }[AgentId];
