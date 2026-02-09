import type { JanitorConfig } from '../config/schema';
import { type AgentDefinition, createAgentDefinition } from './agent-factory';
import { HUNTER_PROFILE } from './agent-profiles';

/**
 * Create the hunter agent definition.
 *
 * Thin wrapper — delegates to the shared factory with the hunter profile.
 */
export function createHunterAgent(config: JanitorConfig): AgentDefinition {
  return createAgentDefinition(HUNTER_PROFILE, config);
}

export type { AgentDefinition };
