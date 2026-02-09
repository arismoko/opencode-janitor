import { toJSONSchema } from 'zod';
import type { JanitorConfig } from '../config/schema';
import type { AgentProfile } from './agent-profiles';
import { resolveAgentModel } from './agent-profiles';

// ---------------------------------------------------------------------------
// Agent definition shape (matches OpenCode's AgentConfig)
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  name: string;
  description: string;
  config: {
    model?: string;
    variant?: string;
    temperature: number;
    prompt: string;
    mode?: 'subagent' | 'primary' | 'all';
    permission?: Record<string, string | Record<string, string>>;
  };
}

/** Shared permission set for all review agents */
const REVIEW_AGENT_PERMISSIONS: Record<string, string> = {
  '*': 'deny',
  glob: 'allow',
  grep: 'allow',
  list: 'allow',
  read: 'allow',
  lsp: 'allow',
};

/**
 * Build the system prompt from an agent profile.
 *
 * Structure:
 *   1. Role preamble
 *   2. Output schema (machine-generated from Zod via toJSONSchema)
 *   3. Extra rules
 */
function buildPromptFromProfile(profile: AgentProfile): string {
  const jsonSchema = toJSONSchema(profile.outputSchema);

  const sections = [
    profile.role,
    '',
    'You MUST output ONLY valid JSON — no prose, no markdown, no explanation outside the JSON.',
    '',
    'Output JSON Schema (strict — your output must validate against this):',
    '```json',
    JSON.stringify(jsonSchema, null, 2),
    '```',
    '',
    'If no issues found, output exactly: {"findings": []}',
  ];

  if (profile.rules) {
    sections.push('', profile.rules);
  }

  return sections.join('\n');
}

/**
 * Create an agent definition from a profile and config.
 *
 * Replaces bespoke `createJanitorAgent` and `createReviewerAgent` with a
 * single profile-driven factory.
 */
export function createAgentDefinition(
  profile: AgentProfile,
  config: JanitorConfig,
): AgentDefinition {
  const { model, variant } = resolveAgentModel(profile, config);

  return {
    name: profile.name,
    description: profile.description,
    config: {
      model,
      variant,
      temperature: 0.1,
      prompt: buildPromptFromProfile(profile),
      mode: 'primary',
      permission: REVIEW_AGENT_PERMISSIONS,
    },
  };
}
