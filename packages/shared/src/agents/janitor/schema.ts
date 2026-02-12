import { z } from 'zod';
import { BaseFinding } from '../core/schema-core';

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
