/**
 * Agent-related types shared across packages.
 */
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Agent name
// ---------------------------------------------------------------------------

export type AgentName = 'janitor' | 'hunter' | 'inspector' | 'scribe';

export const AGENT_NAMES: readonly AgentName[] = [
  'janitor',
  'hunter',
  'inspector',
  'scribe',
] as const;

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
  /** Agent name used for registration (e.g. 'janitor', 'hunter') */
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
