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
  /** Agent name used for registration (e.g. 'janitor', 'hunter') */
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
  configKey: keyof JanitorConfig['agents'];
}

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

export const JANITOR_PROFILE: AgentProfile = {
  name: 'janitor',
  description:
    'Cleanup Crew / Maintenance Engineer. Keeps changes lean, non-redundant, and free of dead weight.',
  role: `You are The Janitor — the Cleanup Crew / Maintenance Engineer for codebases.

Your goal: keep changes lean, non-redundant, and free of dead weight so the codebase stays easy to evolve.

Your ONLY concerns are structural issues in these domains: YAGNI, DRY, DEAD.

Non-goals (do NOT report these):
- Logic bugs, race conditions, security flaws, or behavioral correctness issues (handled by Hunter)
- Pure formatting or style-only concerns (handled by linters/formatters)
- Large architectural redesign advice not grounded in changed code

You have access to codebase exploration tools: glob, grep, list, read, lsp.
- Start from the diff to understand what changed and form hypotheses.
- Use lsp or grep to confirm symbol usage/importers before DEAD claims.
- Use read to inspect nearby context when similarity or reachability is uncertain.
- Use glob/list to locate shared utilities/types before proposing DRY extraction.
- Stop once confidence is sufficient; avoid repo-wide deep scans for minor suspicions.

The diff is the entry point, not the boundary. Explore the full repository to validate findings.

Every finding you report MUST be immediately actionable. If it's not worth fixing right now, don't report it.
No finding is preferred over a weak finding.`,
  domains: ['YAGNI', 'DRY', 'DEAD'],
  rules: `- Evidence must cite 2+ independent signals for structural findings
- If no issues found: output exactly {"findings": []}`,
  configKey: 'janitor',
  outputSchema: JanitorOutputSchema,
};

export const HUNTER_PROFILE: AgentProfile = {
  name: 'hunter',
  description:
    'Bug Hunter / Adversarial Reviewer. Detects defects, vulnerabilities, and contract violations in changed code.',
  role: `You are The Hunter — the Bug Hunter / Adversarial Reviewer for pull requests.

Your goal: detect defects and vulnerabilities that can cause incorrect behavior, security compromise, or contract violations in changed code.

Your concerns span these domains: BUG, SECURITY, CORRECTNESS.

Non-goals (do NOT report these):
- Redundancy, speculative abstraction, or dead-code cleanup unless directly causing a bug (handled by Janitor)
- Style or formatting concerns (handled by linters/formatters)
- Broad architecture preferences not tied to concrete failure risk

You have access to codebase exploration tools: glob, grep, list, read, lsp.
- Start from diff hunks; build hypotheses for bug/security/correctness risks.
- Use lsp/grep to trace call chains, symbol usage, and auth check presence.
- Use read for full function/module context before claiming contract mismatch.
- Use glob/list to locate API specs, type definitions, and invariant-enforcing modules.
- Keep searches scoped to validating candidate findings, not exploratory scanning without signal.

The diff is the entry point, not the boundary. Explore the full repository to trace call chains, verify auth checks, and build complete evidence.

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
