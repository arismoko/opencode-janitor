/**
 * Zod schema for the CLI JSON config.
 *
 * Uses canonical AGENTS/TRIGGERS registries from @opencode-janitor/shared.
 */

import {
  AGENT_IDS,
  AGENTS,
  type AgentId,
  AgentRuntimeConfig,
  PermissionExtensionsSchema,
  ScopeConfig,
  TRIGGER_IDS,
  TRIGGERS,
  type TriggerId,
} from '@opencode-janitor/shared';
import { z } from 'zod';
import { defaultLockPath, defaultPidPath, defaultSocketPath } from './paths';

// ---------------------------------------------------------------------------
// Section schemas
// ---------------------------------------------------------------------------

export const DaemonSection = z.object({
  socketPath: z.string().default(defaultSocketPath),
  pidFile: z.string().default(defaultPidPath),
  lockFile: z.string().default(defaultLockPath),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  webHost: z.string().default('127.0.0.1'),
  webPort: z.number().int().min(1).max(65535).default(7700),
});

export const SchedulerSection = z.object({
  globalConcurrency: z.number().int().min(1).default(2),
  perRepoConcurrency: z.number().int().min(1).default(1),
  agentParallelism: z.number().int().min(1).default(2),
  maxAttempts: z.number().int().min(1).default(3),
  retryBackoffMs: z.number().int().min(100).default(3000),
});

export const DetectorSection = z.object({
  minPollSec: z.number().int().min(1).default(15),
  maxPollSec: z.number().int().min(1).default(60),
  probeConcurrency: z.number().int().min(1).default(4),
  prTtlSec: z.number().int().min(0).default(300),
  pollJitterPct: z.number().int().min(0).max(50).default(10),
});

export const OpencodeSection = z.object({
  defaultModelId: z.string().default(''),
  hubSessionTitle: z.string().default('janitor-hub'),
  serverHost: z.string().default('127.0.0.1'),
  serverPort: z.number().int().min(1).max(65535).default(4096),
  serverStartTimeoutMs: z.number().int().min(1000).default(8000),
  permissionExtensions: PermissionExtensionsSchema.optional(),
});

export const ScopeSection = ScopeConfig;

function makeAgentRuntime(agentId: AgentId) {
  const definition = AGENTS[agentId];
  const defaultMaxFindings = definition.defaults.maxFindings ?? 10;
  const baseDefaults: Record<string, unknown> = {
    enabled: true,
    autoTriggers: [...definition.defaults.autoTriggers],
    ...(definition.defaults.manualScope
      ? { manualDefaultScope: definition.defaults.manualScope }
      : {}),
    maxFindings: defaultMaxFindings,
  };

  return z
    .preprocess((input) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ...baseDefaults };
      }
      return { ...baseDefaults, ...(input as Record<string, unknown>) };
    }, AgentRuntimeConfig)
    .superRefine((value, ctx) => {
      for (const [index, trigger] of value.autoTriggers.entries()) {
        if (!definition.capabilities.autoTriggers.includes(trigger)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['autoTriggers', index],
            message: `trigger "${trigger}" is not supported by agent "${agentId}"`,
          });
        }
      }

      if (
        value.manualDefaultScope &&
        !definition.capabilities.manualScopes.includes(value.manualDefaultScope)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['manualDefaultScope'],
          message: `scope "${value.manualDefaultScope}" is not supported by agent "${agentId}"`,
        });
      }
    })
    .prefault({});
}

const agentShape = Object.fromEntries(
  AGENT_IDS.map((agentId) => [agentId, makeAgentRuntime(agentId)]),
) as unknown as Record<AgentId, z.ZodTypeAny>;

const triggerShape = Object.fromEntries(
  TRIGGER_IDS.map((triggerId) => [
    triggerId,
    TRIGGERS[triggerId].configSchema.prefault({}),
  ]),
) as unknown as Record<TriggerId, z.ZodTypeAny>;

export type AgentRuntimeSection = {
  [K in AgentId]: z.infer<typeof AgentRuntimeConfig>;
};

export type TriggerRuntimeSection = {
  [K in TriggerId]: z.infer<(typeof TRIGGERS)[K]['configSchema']>;
};

export const AgentsSection = z.strictObject(
  agentShape,
) as unknown as z.ZodType<AgentRuntimeSection>;
export const TriggersSection = z.strictObject(
  triggerShape,
) as unknown as z.ZodType<TriggerRuntimeSection>;

// ---------------------------------------------------------------------------
// Top-level config schema
// ---------------------------------------------------------------------------

export interface CliConfig {
  daemon: z.infer<typeof DaemonSection>;
  scheduler: z.infer<typeof SchedulerSection>;
  detector: z.infer<typeof DetectorSection>;
  opencode: z.infer<typeof OpencodeSection>;
  scope: z.infer<typeof ScopeSection>;
  agents: AgentRuntimeSection;
  triggers: TriggerRuntimeSection;
}

export const CliConfigSchema = z.object({
  daemon: DaemonSection.prefault({}),
  scheduler: SchedulerSection.prefault({}),
  detector: DetectorSection.prefault({}),
  opencode: OpencodeSection.prefault({}),
  scope: ScopeSection.prefault({}),
  agents: AgentsSection.prefault({} as AgentRuntimeSection),
  triggers: TriggersSection.prefault({} as TriggerRuntimeSection),
}) as unknown as z.ZodType<CliConfig>;

/** Schema-validated default config object. */
export const defaultCliConfig: CliConfig = CliConfigSchema.parse({});
