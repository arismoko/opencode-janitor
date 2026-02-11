/**
 * Agent factory — builds agent definitions from shared profiles and CLI config.
 *
 * Plugin-style: data-driven agent configuration with centralized permission map.
 */
import type { AgentConfig } from '@opencode-ai/sdk';
import type { AgentName, AgentProfile } from '@opencode-janitor/shared';
import { AGENT_NAMES, agentProfiles } from '@opencode-janitor/shared';
import { toJSONSchema, z } from 'zod';
import type { CliConfig } from '../config/schema';

// ---------------------------------------------------------------------------
// Permission map (plugin-style allowlist for review agents)
// ---------------------------------------------------------------------------

/** Centralized permission allowlist for all review agents. */
export type ReviewAgentPermission = NonNullable<AgentConfig['permission']>;
export type ReviewAgentTools = NonNullable<AgentConfig['tools']>;
export type ReviewAgentConfig = Pick<
  AgentConfig,
  'mode' | 'prompt' | 'permission' | 'tools' | 'maxSteps' | 'model'
>;

const PermissionDecisionSchema = z.enum(['ask', 'allow', 'deny']);

const ReviewAgentPermissionSchema = z.object({
  edit: PermissionDecisionSchema.optional(),
  bash: z
    .union([
      PermissionDecisionSchema,
      z.record(z.string(), PermissionDecisionSchema),
    ])
    .optional(),
  webfetch: PermissionDecisionSchema.optional(),
  doom_loop: PermissionDecisionSchema.optional(),
  external_directory: PermissionDecisionSchema.optional(),
});

const ReviewAgentConfigSchema = z.object({
  mode: z.enum(['subagent', 'primary', 'all']),
  prompt: z.string().min(1),
  permission: ReviewAgentPermissionSchema.optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  maxSteps: z.number().int().min(1),
  model: z.string().min(1).optional(),
});

/** Centralized permission policy for all review agents. */
export const REVIEW_AGENT_PERMISSIONS: ReviewAgentPermission = {
  edit: 'deny',
  bash: 'deny',
  webfetch: 'deny',
  doom_loop: 'deny',
  external_directory: 'deny',
};

/** Explicit allowlist of tools exposed to review agents. */
export const REVIEW_AGENT_TOOLS: ReviewAgentTools = {
  glob: true,
  grep: true,
  list: true,
  read: true,
  lsp: true,
};

function validateAgentConfig(
  agent: AgentName,
  config: ReviewAgentConfig,
): ReviewAgentConfig {
  const result = ReviewAgentConfigSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid agent config for "${agent}": ${issues}`);
}

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  name: AgentName;
  description: string;
  config: ReviewAgentConfig;
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/** Build a system prompt from a profile, including role, domains, rules, and JSON schema. */
export function buildSystemPrompt(profile: AgentProfile): string {
  const schema = JSON.stringify(toJSONSchema(profile.outputSchema), null, 2);

  const sections: string[] = [
    profile.role,
    '',
    `# DOMAINS`,
    profile.domains.join(', '),
  ];

  if (profile.rules) {
    sections.push('', `# RULES`, profile.rules);
  }

  sections.push(
    '',
    `# OUTPUT SCHEMA`,
    'Return ONLY valid JSON matching this schema. No markdown fences, no commentary.',
    '```json',
    schema,
    '```',
  );

  return sections.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/** Create an AgentDefinition from a profile and CLI config. */
export function createAgentDefinition(
  profile: AgentProfile,
  config: CliConfig,
): AgentDefinition {
  const agentConfig = config.agents[profile.name];
  const modelID = agentConfig.modelId ?? config.opencode.defaultModelId;

  const runtimeConfig = validateAgentConfig(profile.name, {
    mode: 'subagent',
    prompt: buildSystemPrompt(profile),
    permission: REVIEW_AGENT_PERMISSIONS,
    tools: REVIEW_AGENT_TOOLS,
    maxSteps: 2,
    ...(modelID ? { model: modelID } : {}),
  });

  return {
    name: profile.name,
    description: profile.description,
    config: runtimeConfig,
  };
}

/** Create a map of all agent definitions keyed by agent name. */
export function createAgentConfigMap(
  config: CliConfig,
): Record<AgentName, AgentDefinition> {
  const map = {} as Record<AgentName, AgentDefinition>;
  for (const name of AGENT_NAMES) {
    map[name] = createAgentDefinition(
      agentProfiles.AGENT_PROFILES[name],
      config,
    );
  }
  return map;
}
