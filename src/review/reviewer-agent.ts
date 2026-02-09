import type { JanitorConfig } from '../config/schema';
import { type AgentDefinition, createAgentDefinition } from './agent-factory';
import { REVIEWER_PROFILE } from './agent-profiles';

/**
 * Create the reviewer agent definition.
 *
 * Thin wrapper — delegates to the shared factory with the reviewer profile.
 */
export function createReviewerAgent(config: JanitorConfig): AgentDefinition {
  return createAgentDefinition(REVIEWER_PROFILE, config);
}

export type { AgentDefinition };
