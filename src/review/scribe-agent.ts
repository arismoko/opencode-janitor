import type { JanitorConfig } from '../config/schema';
import { type AgentDefinition, createAgentDefinition } from './agent-factory';
import { SCRIBE_PROFILE } from './agent-profiles';

/**
 * Create the scribe agent definition.
 *
 * Thin wrapper — delegates to the shared factory with the scribe profile.
 */
export function createScribeAgent(config: JanitorConfig): AgentDefinition {
  return createAgentDefinition(SCRIBE_PROFILE, config);
}
