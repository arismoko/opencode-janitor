import type { z } from 'zod';
import type { JanitorConfig } from '../config/schema';
import {
  HunterOutput as HunterOutputSchema,
  JanitorOutput as JanitorOutputSchema,
} from '../schemas/finding';
import { SEVERITY_GUIDE } from '../types';

// ---------------------------------------------------------------------------
// Agent profile — data-driven agent definition
// ---------------------------------------------------------------------------

export interface AgentProfile {
  /** Agent name used for registration (e.g. 'janitor', 'bug-hunter') */
  name: string;
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
  /** Config key under agents.* for model/variant/trigger resolution */
  configKey: 'janitor' | 'hunter';
}

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

export const JANITOR_PROFILE: AgentProfile = {
  name: 'janitor',
  description:
    'Structural code health reviewer. Detects DRY violations, dead code, and YAGNI issues.',
  role: `You are The Janitor — a structural code health reviewer for codebases.

Your ONLY concerns are structural issues in these domains: YAGNI, DRY, DEAD.

You do NOT look for bugs, correctness issues, runtime failures, style preferences, or performance issues.

You have access to codebase exploration tools: glob, grep, list, read.
Use them to trace references, find duplicates, and verify your findings with evidence.

Every finding you report MUST be immediately actionable. If it's not worth fixing right now, don't report it.
No finding is preferred over a weak finding.`,
  domains: ['YAGNI', 'DRY', 'DEAD'],
  rules: `- Evidence must cite 2+ independent signals for structural findings
- If no issues found: output exactly {"findings": []}`,
  configKey: 'janitor',
  outputSchema: JanitorOutputSchema,
};

export const HUNTER_PROFILE: AgentProfile = {
  name: 'bug-hunter',
  description:
    'Comprehensive bug hunter for PRs. Detects bugs, security vulnerabilities, and correctness issues.',
  role: `You are a comprehensive bug hunter for pull requests.

Your concerns span: bugs, security vulnerabilities, and correctness issues.

You have access to codebase exploration tools: glob, grep, list, read.
Use them to trace references, verify context, and ground your findings in evidence.

Report ALL findings you discover, organized by severity. Be thorough.`,
  domains: ['BUG', 'SECURITY', 'CORRECTNESS'],
  rules: `Severity guide:
${SEVERITY_GUIDE.map((s) => `- ${s}`).join('\n')}`,
  configKey: 'hunter',
  outputSchema: HunterOutputSchema,
};

/**
 * Resolve the model ID for an agent from config, falling back to the
 * global model ID.
 */
export function resolveAgentModel(
  profile: AgentProfile,
  config: JanitorConfig,
): { model?: string; variant?: string } {
  const agentConfig = config.agents[profile.configKey];
  return {
    model: agentConfig.modelId ?? config.model.id,
    variant: agentConfig.variant,
  };
}
