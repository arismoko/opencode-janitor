/**
 * Agent-related types shared across packages.
 */
import type { z } from 'zod';
import { AGENT_IDS, AGENTS, type AgentId } from '../agents';

// ---------------------------------------------------------------------------
// Agent name
// ---------------------------------------------------------------------------

export type AgentName = AgentId;

export const AGENT_NAMES: readonly AgentName[] = AGENT_IDS;

// ---------------------------------------------------------------------------
// Agent profile (data-driven agent definition)
// ---------------------------------------------------------------------------

/**
 * Data-driven agent definition.
 *
 * Decoupled from config — consumers resolve model/trigger settings
 * from their own config schemas.
 */
export interface AgentProfile {
  /** Agent name used for registration. */
  name: AgentName;
  /** Human-readable description */
  description: string;
  /** Role preamble for the system prompt */
  role: string;
  /** Domains this agent covers (e.g. ['YAGNI', 'DRY', 'DEAD']) */
  domains: readonly string[];
  /** Extra rules appended to the system prompt */
  rules?: string;
  /** Zod output schema for JSON schema injection */
  outputSchema: z.ZodType;
}

export function toAgentProfile(agent: AgentName): AgentProfile {
  const definition = AGENTS[agent];
  return {
    name: definition.id,
    description: definition.description,
    role: definition.role,
    domains: definition.domains,
    rules: definition.rules,
    outputSchema: definition.outputSchema,
  };
}
