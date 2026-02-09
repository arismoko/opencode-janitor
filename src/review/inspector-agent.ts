import type { JanitorConfig } from '../config/schema';
import { type AgentDefinition, createAgentDefinition } from './agent-factory';
import { INSPECTOR_PROFILE } from './agent-profiles';

/**
 * Create the inspector agent definition.
 *
 * Thin wrapper — delegates to the shared factory with the inspector profile.
 */
export function createInspectorAgent(config: JanitorConfig): AgentDefinition {
  return createAgentDefinition(INSPECTOR_PROFILE, config);
}
