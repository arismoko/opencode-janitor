/**
 * Shared Zod schemas for agent output validation.
 */
import { z } from 'zod';

export const Severity = z.enum(['P0', 'P1', 'P2', 'P3']);
export type Severity = z.infer<typeof Severity>;

export const BaseFinding = z.object({
  location: z.string().describe('file:line'),
  severity: Severity,
  evidence: z.string().describe('Concrete proof of the issue'),
  prescription: z.string().describe('Exact action to fix'),
});

export const JANITOR_DOMAIN_VALUES = ['YAGNI', 'DRY', 'DEAD'] as const;
export const JanitorDomain = z.enum(JANITOR_DOMAIN_VALUES).catch('YAGNI');
export type JanitorDomain = z.infer<typeof JanitorDomain>;

export const JanitorFinding = BaseFinding.extend({
  domain: JanitorDomain,
});
export type JanitorFinding = z.infer<typeof JanitorFinding>;

export const JanitorOutput = z.object({
  findings: z.array(JanitorFinding),
});
export type JanitorOutput = z.infer<typeof JanitorOutput>;

export const HUNTER_DOMAIN_VALUES = ['BUG', 'CORRECTNESS'] as const;
export const HunterDomain = z.enum(HUNTER_DOMAIN_VALUES).catch('BUG');
export type HunterDomain = z.infer<typeof HunterDomain>;

export const HunterFinding = BaseFinding.extend({
  domain: HunterDomain,
});
export type HunterFinding = z.infer<typeof HunterFinding>;

export const HunterOutput = z.object({
  findings: z.array(HunterFinding),
});
export type HunterOutput = z.infer<typeof HunterOutput>;

export const INSPECTOR_DOMAIN_VALUES = [
  'COMPLEXITY',
  'DESIGN',
  'SMELL',
] as const;
export const InspectorDomain = z.enum(INSPECTOR_DOMAIN_VALUES).catch('SMELL');
export type InspectorDomain = z.infer<typeof InspectorDomain>;

export const InspectorFinding = BaseFinding.extend({
  domain: InspectorDomain,
});
export type InspectorFinding = z.infer<typeof InspectorFinding>;

export const InspectorOutput = z.object({
  findings: z.array(InspectorFinding),
});
export type InspectorOutput = z.infer<typeof InspectorOutput>;

export const SCRIBE_DOMAIN_VALUES = ['DRIFT', 'GAP', 'RELEASE'] as const;
export const ScribeDomain = z.enum(SCRIBE_DOMAIN_VALUES).catch('GAP');
export type ScribeDomain = z.infer<typeof ScribeDomain>;

export const ScribeFinding = BaseFinding.extend({
  domain: ScribeDomain,
});
export type ScribeFinding = z.infer<typeof ScribeFinding>;

export const ScribeOutput = z.object({
  findings: z.array(ScribeFinding),
});
export type ScribeOutput = z.infer<typeof ScribeOutput>;
