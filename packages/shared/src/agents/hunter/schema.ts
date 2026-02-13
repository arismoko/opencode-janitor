import { z } from 'zod';
import { BaseFinding } from '../core/schema-core';

export const HUNTER_DOMAIN_VALUES = ['BUG', 'CORRECTNESS'] as const;
export const HunterDomain = z.enum(HUNTER_DOMAIN_VALUES).catch('BUG');
export type HunterDomain = z.infer<typeof HunterDomain>;

export const HUNTER_BUG_CATEGORY_VALUES = [
  'RACE_CONDITION',
  'NULL_DEREF',
  'OFF_BY_ONE',
  'TYPE_COERCION',
  'BOUNDARY_VIOLATION',
  'RESOURCE_LEAK',
  'MISSING_VALIDATION',
  'STATE_CORRUPTION',
  'LOGIC_ERROR',
  'CONTRACT_VIOLATION',
  'UNHANDLED_EDGE_CASE',
  'OTHER',
] as const;
export const HunterBugCategory = z.enum(HUNTER_BUG_CATEGORY_VALUES);
export type HunterBugCategory = z.infer<typeof HunterBugCategory>;

export const HUNTER_FAILURE_MODE_VALUES = [
  'CRASH',
  'DATA_CORRUPTION',
  'SILENT_WRONG_RESULT',
  'HANG',
  'SECURITY_BYPASS',
  'DEGRADED_PERFORMANCE',
  'PARTIAL_FAILURE',
  'OTHER',
] as const;
export const HunterFailureMode = z.enum(HUNTER_FAILURE_MODE_VALUES);
export type HunterFailureMode = z.infer<typeof HunterFailureMode>;

export const HUNTER_BLAST_RADIUS_VALUES = [
  'ISOLATED',
  'MODULE',
  'SYSTEM_WIDE',
] as const;
export const HunterBlastRadius = z.enum(HUNTER_BLAST_RADIUS_VALUES);
export type HunterBlastRadius = z.infer<typeof HunterBlastRadius>;

export const HUNTER_CONFIDENCE_VALUES = [
  'CERTAIN',
  'HIGH',
  'MEDIUM',
  'SPECULATIVE',
] as const;
export const HunterConfidence = z.enum(HUNTER_CONFIDENCE_VALUES);
export type HunterConfidence = z.infer<typeof HunterConfidence>;

export const HunterBugAnalysis = z.object({
  category: HunterBugCategory,
  failureMode: HunterFailureMode,
  blastRadius: HunterBlastRadius,
  confidence: HunterConfidence,
  triggerConditions: z
    .array(z.string().min(1))
    .min(1)
    .max(4)
    .describe('Steps or conditions that trigger the defect'),
  affectedPaths: z
    .array(z.string().min(1))
    .min(1)
    .max(5)
    .describe(
      'Call-chain or data-flow paths through which the defect propagates',
    ),
});
export type HunterBugAnalysis = z.infer<typeof HunterBugAnalysis>;

export const HunterFinding = BaseFinding.extend({
  domain: HunterDomain,
  bugAnalysis: HunterBugAnalysis,
});
export type HunterFinding = z.infer<typeof HunterFinding>;

export const HunterOutput = z.object({
  findings: z.array(HunterFinding),
});
export type HunterOutput = z.infer<typeof HunterOutput>;
