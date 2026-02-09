/**
 * Shared config schema fragments.
 *
 * Agent-level settings that are common across CLI (TOML) and plugin (JSON)
 * config formats. Each consumer wraps these in their own top-level schema.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Trigger mode
// ---------------------------------------------------------------------------

export const TriggerMode = z.enum(['commit', 'pr', 'both', 'manual', 'never']);
export type TriggerMode = z.infer<typeof TriggerMode>;

// ---------------------------------------------------------------------------
// Per-agent runtime config
// ---------------------------------------------------------------------------

export const AgentRuntimeConfig = z.object({
  enabled: z.boolean().default(true),
  trigger: TriggerMode.default('manual'),
  modelId: z.string().optional(),
  variant: z.string().optional(),
  maxFindings: z.number().int().min(1).max(50).default(10),
});
export type AgentRuntimeConfig = z.infer<typeof AgentRuntimeConfig>;

// ---------------------------------------------------------------------------
// Scope config (shared file patterns)
// ---------------------------------------------------------------------------

export const ScopeConfig = z.object({
  include: z
    .array(z.string())
    .default(['**/*.{ts,tsx,js,jsx,py,go,rs,java,rb,swift,kt}']),
  exclude: z
    .array(z.string())
    .default([
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/*.test.*',
      '**/*.spec.*',
      '**/__tests__/**',
    ]),
});
export type ScopeConfig = z.infer<typeof ScopeConfig>;

// ---------------------------------------------------------------------------
// Diff limits config
// ---------------------------------------------------------------------------

export const DiffConfig = z.object({
  maxPatchBytes: z.number().int().min(10_000).default(200_000),
  maxFilesInPatch: z.number().int().min(1).default(50),
  maxHunksPerFile: z.number().int().min(1).default(8),
});
export type DiffConfig = z.infer<typeof DiffConfig>;
