/**
 * Default agent specs — registers all built-in agents into a registry.
 *
 * Uses strategy-local spec factories for each agent instead of a
 * generic factory, allowing each strategy to own its context building.
 */
import { agentProfiles } from '@opencode-janitor/shared';
import { createHunterSpec } from '../reviews/strategies/hunter-strategy';
import { createInspectorSpec } from '../reviews/strategies/inspector-strategy';
import { createJanitorSpec } from '../reviews/strategies/janitor-strategy';
import { createScribeSpec } from '../reviews/strategies/scribe-strategy';
import {
  type AgentRuntimeRegistry,
  createAgentRuntimeRegistry,
} from './agent-runtime-registry';

/**
 * Build a registry pre-populated with all default agent specs
 * (janitor, hunter, inspector, scribe).
 */
export function createDefaultAgentRegistry(): AgentRuntimeRegistry {
  const registry = createAgentRuntimeRegistry();

  registry.register(createJanitorSpec(agentProfiles.AGENT_PROFILES.janitor));
  registry.register(createHunterSpec(agentProfiles.AGENT_PROFILES.hunter));
  registry.register(
    createInspectorSpec(agentProfiles.AGENT_PROFILES.inspector),
  );
  registry.register(createScribeSpec(agentProfiles.AGENT_PROFILES.scribe));

  return registry;
}
