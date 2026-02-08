import { z } from 'zod';

export const JanitorConfigSchema = z.object({
  enabled: z.boolean().default(true),

  autoReview: z
    .object({
      onCommit: z.boolean().default(true),
      debounceMs: z.number().int().min(0).default(1200),
      pollFallbackSec: z.number().int().min(5).default(15),
    })
    .default({}),

  categories: z
    .object({
      DRY: z.boolean().default(true),
      DEAD: z.boolean().default(true),
      YAGNI: z.boolean().default(true),
      STRUCTURAL: z.boolean().default(true),
    })
    .default({}),

  scope: z
    .object({
      include: z
        .array(z.string())
        .default([
          '**/*.{ts,tsx,js,jsx,py,go,rs,java,rb,swift,kt}',
        ]),
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
    })
    .default({}),

  model: z
    .object({
      id: z.string().optional(),
      maxFindings: z.number().int().min(1).max(50).default(10),
    })
    .default({}),

  diff: z
    .object({
      maxPatchBytes: z
        .number()
        .int()
        .min(10_000)
        .default(200_000),
      maxFilesInPatch: z.number().int().min(1).default(50),
      maxHunksPerFile: z.number().int().min(1).default(8),
      mergeMode: z
        .enum(['first-parent', 'combined'])
        .default('first-parent'),
    })
    .default({}),

  delivery: z
    .object({
      toast: z.boolean().default(true),
      sessionMessage: z.boolean().default(true),
      reportFile: z.boolean().default(true),
      reportDir: z.string().default('.janitor/reports'),
    })
    .default({}),

  queue: z
    .object({
      concurrency: z.number().int().min(1).max(3).default(1),
      dropIntermediate: z.boolean().default(true),
    })
    .default({}),
});

export type JanitorConfig = z.infer<typeof JanitorConfigSchema>;
