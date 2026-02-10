/**
 * Zod schema for the CLI TOML config.
 *
 * Uses shared TriggerMode + AgentRuntimeConfig fragments from @opencode-janitor/shared.
 */

import {
  AgentRuntimeConfig,
  ScopeConfig,
  TriggerMode,
} from '@opencode-janitor/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Section schemas
// ---------------------------------------------------------------------------

export const DaemonSection = z.object({
  socketPath: z.string().default('/tmp/opencode-janitor.sock'),
  pidFile: z.string().default('/tmp/opencode-janitor.pid'),
  lockFile: z.string().default('/tmp/opencode-janitor.lock'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const SchedulerSection = z.object({
  globalConcurrency: z.number().int().min(1).default(2),
  perRepoConcurrency: z.number().int().min(1).default(1),
  agentParallelism: z.number().int().min(1).default(2),
  maxAttempts: z.number().int().min(1).default(3),
  retryBackoffMs: z.number().int().min(100).default(3000),
});

export const GitSection = z.object({
  commitDebounceMs: z.number().int().min(0).default(1200),
  commitPollSec: z.number().int().min(1).default(15),
  prPollSec: z.number().int().min(5).default(20),
  prBaseBranch: z.string().default('main'),
  enableFsWatch: z.boolean().default(true),
  enableGhPr: z.boolean().default(true),
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
});

export const ScopeSection = ScopeConfig;

const makeAgentRuntime = (trigger: 'commit' | 'pr' | 'manual') =>
  AgentRuntimeConfig.extend({
    trigger: TriggerMode.default(trigger),
  }).prefault({
    enabled: true,
    trigger,
    maxFindings: 10,
  });

export const AgentsSection = z.object({
  janitor: makeAgentRuntime('commit'),
  hunter: makeAgentRuntime('pr'),
  inspector: makeAgentRuntime('manual'),
  scribe: makeAgentRuntime('manual'),
});

// ---------------------------------------------------------------------------
// Top-level config schema
// ---------------------------------------------------------------------------

export const CliConfigSchema = z.object({
  daemon: DaemonSection.prefault({}),
  scheduler: SchedulerSection.prefault({}),
  git: GitSection.prefault({}),
  detector: DetectorSection.prefault({}),
  opencode: OpencodeSection.prefault({}),
  scope: ScopeSection.prefault({}),
  agents: AgentsSection.prefault({}),
});

export type CliConfig = z.infer<typeof CliConfigSchema>;

/** Schema-validated default config object. */
export const defaultCliConfig: CliConfig = CliConfigSchema.parse({});
