/**
 * Default agent specs — registers all built-in agents into a registry.
 *
 * Uses shared AGENT_PROFILES and AGENT_NAMES to create specs via the
 * generic createAgentRuntimeSpec factory.
 */
import { AGENT_NAMES, agentProfiles } from '@opencode-janitor/shared';
import {
  type AgentRuntimeRegistry,
  createAgentRuntimeRegistry,
} from './agent-runtime-registry';
import { createAgentRuntimeSpec } from './agent-runtime-spec';

/**
 * Build a registry pre-populated with all default agent specs
 * (janitor, hunter, inspector, scribe).
 */
export function createDefaultAgentRegistry(): AgentRuntimeRegistry {
  const registry = createAgentRuntimeRegistry();

  for (const name of AGENT_NAMES) {
    const profile = agentProfiles.AGENT_PROFILES[name];
    registry.register(createAgentRuntimeSpec(profile));
  }

  return registry;
}
