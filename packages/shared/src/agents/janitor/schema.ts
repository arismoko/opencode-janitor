import { z } from 'zod';
import { BaseFinding } from '../core/schema-core';

export const JANITOR_DOMAIN_VALUES = ['YAGNI', 'DRY', 'DEAD'] as const;
export const JanitorDomain = z.enum(JANITOR_DOMAIN_VALUES).catch('YAGNI');
export type JanitorDomain = z.infer<typeof JanitorDomain>;

export const JANITOR_ACTION_VALUES = [
  'DELETE',
  'EXTRACT',
  'INLINE',
  'MERGE',
  'REPLACE',
  'SIMPLIFY',
  'OTHER',
] as const;
export const JanitorAction = z.enum(JANITOR_ACTION_VALUES);
export type JanitorAction = z.infer<typeof JanitorAction>;

export const JANITOR_EFFORT_VALUES = ['TRIVIAL', 'SMALL', 'MEDIUM'] as const;
export const JanitorEffort = z.enum(JANITOR_EFFORT_VALUES);
export type JanitorEffort = z.infer<typeof JanitorEffort>;

export const JanitorCleanupMap = z.object({
  action: JanitorAction,
  effort: JanitorEffort,
  linesAffected: z
    .number()
    .int()
    .min(1)
    .describe('Approximate number of lines to add/remove/change'),
  targets: z
    .array(z.string().min(1))
    .min(1)
    .max(6)
    .describe('Symbols, files, or code spans targeted by the cleanup'),
  safetyNote: z
    .string()
    .min(1)
    .describe('Why the cleanup is safe to perform without side effects'),
});
export type JanitorCleanupMap = z.infer<typeof JanitorCleanupMap>;

export const JanitorFinding = BaseFinding.extend({
  domain: JanitorDomain,
  cleanupMap: JanitorCleanupMap,
});
export type JanitorFinding = z.infer<typeof JanitorFinding>;

export const JanitorOutput = z.object({
  findings: z.array(JanitorFinding),
});
export type JanitorOutput = z.infer<typeof JanitorOutput>;
