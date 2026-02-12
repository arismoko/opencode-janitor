/**
 * @opencode-janitor/shared
 *
 * Shared domain logic for the review-agent ecosystem.
 */

export * from './agents';
export * from './capabilities';
export * from './git/review-key';
export * as findingSchemas from './review/finding-schemas';
export { Severity } from './review/finding-schemas';
export * from './review/output-codec';
export * from './review/prompt-builder';
export type {
  PermissionDecision,
  PermissionExtensions,
  PermissionPatternMap,
  PermissionRule,
} from './schemas/config';
export * as configSchemas from './schemas/config';
export {
  AgentRuntimeConfig,
  PermissionDecisionSchema,
  PermissionExtensionsSchema,
  PermissionPatternMapSchema,
  PermissionRuleSchema,
  ScopeConfig,
  ScopeIdSchema,
  TriggerIdSchema,
} from './schemas/config';
export * from './scopes';
export * from './triggers';
export * from './types/agent';
export * as findingTypes from './types/finding';
export * from './types/review';
export * from './utils/format-helpers';
