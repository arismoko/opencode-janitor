/**
 * Agent factory — builds agent definitions from shared profiles and CLI config.
 *
 * Plugin-style: data-driven agent configuration from shared agent definitions.
 */
import type { AgentConfig } from '@opencode-ai/sdk';
import {
  AGENT_IDS,
  AGENTS,
  type AgentId,
  PermissionDecisionSchema,
  PermissionPatternMapSchema,
} from '@opencode-janitor/shared';
import { toJSONSchema, z } from 'zod';
import type { CliConfig } from '../config/schema';
import { mergePermissionExtensions } from './permission-merge';

// ---------------------------------------------------------------------------
// Runtime config validation
// ---------------------------------------------------------------------------

export type ReviewAgentConfig = Pick<
  AgentConfig,
  'mode' | 'prompt' | 'permission' | 'maxSteps' | 'model'
> & {
  variant?: string;
};

const ReviewAgentPermissionRuleSchema = z.union([
  PermissionDecisionSchema,
  PermissionPatternMapSchema,
]);

const ReviewAgentPermissionSchema = z.record(
  z.string(),
  ReviewAgentPermissionRuleSchema,
);

const ReviewAgentConfigSchema = z.object({
  mode: z.enum(['subagent', 'primary', 'all']),
  prompt: z.string().min(1),
  permission: ReviewAgentPermissionSchema.optional(),
  maxSteps: z.number().int().min(1),
  model: z.string().min(1).optional(),
  variant: z.string().min(1).optional(),
});

function validateAgentConfig(
  agent: AgentId,
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
  name: AgentId;
  description: string;
  config: ReviewAgentConfig;
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/** Build a system prompt from canonical definition fields. */
type CanonicalAgentDefinition = (typeof AGENTS)[AgentId];

export function buildSystemPrompt(
  definition: CanonicalAgentDefinition,
): string {
  const schema = JSON.stringify(toJSONSchema(definition.outputSchema), null, 2);

  const sections: string[] = [
    definition.role,
    '',
    `# DOMAINS`,
    definition.domains.join(', '),
  ];

  if (definition.rules) {
    sections.push('', `# RULES`, definition.rules);
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
  definition: CanonicalAgentDefinition,
  config: CliConfig,
): AgentDefinition {
  const agentConfig = config.agents[definition.id];
  const modelID = agentConfig.modelId ?? config.opencode.defaultModelId;
  const variant = agentConfig.variant?.trim();
  const runtimePermission = mergePermissionExtensions(
    definition.runtime.permission,
    config.opencode.permissionExtensions,
    agentConfig.permissionExtensions,
  ) as NonNullable<AgentConfig['permission']>;

  const runtimeConfig = validateAgentConfig(definition.id, {
    mode: 'subagent',
    prompt: buildSystemPrompt(definition),
    permission: runtimePermission,
    maxSteps: definition.runtime.maxSteps,
    ...(modelID ? { model: modelID } : {}),
    ...(variant ? { variant } : {}),
  });

  return {
    name: definition.id,
    description: definition.description,
    config: runtimeConfig,
  };
}

/** Create a map of all agent definitions keyed by agent name. */
export function createAgentConfigMap(
  config: CliConfig,
): Record<AgentId, AgentDefinition> {
  const map = {} as Record<AgentId, AgentDefinition>;
  for (const id of AGENT_IDS) {
    map[id] = createAgentDefinition(AGENTS[id], config);
  }
  return map;
}
