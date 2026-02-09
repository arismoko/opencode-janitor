import type { JanitorConfig } from '../config/schema';
import { type AgentDefinition, createAgentDefinition } from './agent-factory';
import { JANITOR_PROFILE } from './agent-profiles';

export type { AgentDefinition };

/**
 * Create the janitor agent definition.
 *
 * Thin wrapper — delegates to the shared factory with the janitor profile.
 */
export function createJanitorAgent(config: JanitorConfig): AgentDefinition {
  return createAgentDefinition(JANITOR_PROFILE, config);
}
