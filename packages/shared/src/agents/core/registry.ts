import { HUNTER_AGENT_DEFINITION } from '../hunter/definition';
import { INSPECTOR_AGENT_DEFINITION } from '../inspector/definition';
import { JANITOR_AGENT_DEFINITION } from '../janitor/definition';
import { SCRIBE_AGENT_DEFINITION } from '../scribe/definition';

export type AgentDefinitionMap = {
  janitor: typeof JANITOR_AGENT_DEFINITION;
  hunter: typeof HUNTER_AGENT_DEFINITION;
  inspector: typeof INSPECTOR_AGENT_DEFINITION;
  scribe: typeof SCRIBE_AGENT_DEFINITION;
};

export const AGENTS: AgentDefinitionMap = {
  janitor: JANITOR_AGENT_DEFINITION,
  hunter: HUNTER_AGENT_DEFINITION,
  inspector: INSPECTOR_AGENT_DEFINITION,
  scribe: SCRIBE_AGENT_DEFINITION,
};

export type AgentId = keyof typeof AGENTS;

export const AGENT_IDS: readonly AgentId[] = Object.keys(AGENTS) as AgentId[];
