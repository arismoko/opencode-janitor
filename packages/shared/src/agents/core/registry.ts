import { AGENT_MANIFEST } from './manifest.generated';

const AGENT_DEFINITIONS = AGENT_MANIFEST.map((entry) => entry.definition);

type AnyAgentDefinition = (typeof AGENT_DEFINITIONS)[number];

export type AgentId = AnyAgentDefinition['id'];

export type AgentDefinitionMap = {
  [K in AgentId]: Extract<AnyAgentDefinition, { id: K }>;
};

export const AGENT_IDS = AGENT_DEFINITIONS.map(
  (definition) => definition.id,
) as readonly AgentId[];

export const AGENTS = Object.fromEntries(
  AGENT_DEFINITIONS.map((definition) => [definition.id, definition]),
) as AgentDefinitionMap;
