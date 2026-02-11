/**
 * @opencode-janitor/shared
 *
 * Shared domain logic for the janitor ecosystem.
 */

export * from './agents';
export * from './capabilities';
export * from './git/review-key';
export * as agentProfiles from './review/agent-profiles';
export * from './review/output-codec';
export * from './review/prompt-builder';
export * as configSchemas from './schemas/config';
export {
  AgentRuntimeConfig,
  DiffConfig,
  ScopeConfig,
  ScopeIdSchema,
  TriggerIdSchema,
} from './schemas/config';
export * as findingSchemas from './schemas/finding';
export { Severity } from './schemas/finding';
export * from './scopes';
export * from './triggers';
export * from './types/agent';
export * as findingTypes from './types/finding';
export * from './types/review';
export * from './types/trigger';
export * from './utils/format-helpers';
