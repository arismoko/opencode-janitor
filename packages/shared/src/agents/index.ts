import { HUNTER_AGENT_DEFINITION } from './definitions/hunter';
import { INSPECTOR_AGENT_DEFINITION } from './definitions/inspector';
import { JANITOR_AGENT_DEFINITION } from './definitions/janitor';
import { SCRIBE_AGENT_DEFINITION } from './definitions/scribe';

export { defineAgent } from './define-agent';
export { HUNTER_AGENT_DEFINITION } from './definitions/hunter';
export { INSPECTOR_AGENT_DEFINITION } from './definitions/inspector';
export { JANITOR_AGENT_DEFINITION } from './definitions/janitor';
export { SCRIBE_AGENT_DEFINITION } from './definitions/scribe';
export {
  buildReviewAgentRuntime,
  DEFAULT_REVIEW_AGENT_MAX_STEPS,
  DEFAULT_REVIEW_AGENT_PERMISSIONS,
  DEFAULT_REVIEW_AGENT_RUNTIME,
} from './runtime';
export type {
  AgentContextMeta,
  AgentContextReason,
  AgentDefinition,
  AgentPermissionDecision,
  AgentPermissionPolicy,
  AgentRuntimePolicy,
  EnrichContextInput,
  ResolveManualScopeInput,
} from './types';

export const AGENTS = {
  janitor: JANITOR_AGENT_DEFINITION,
  hunter: HUNTER_AGENT_DEFINITION,
  inspector: INSPECTOR_AGENT_DEFINITION,
  scribe: SCRIBE_AGENT_DEFINITION,
} as const;

export type AgentId = keyof typeof AGENTS;

export const AGENT_IDS: readonly AgentId[] = Object.keys(AGENTS) as AgentId[];

export function isAgentId(value: string): value is AgentId {
  return value in AGENTS;
}
