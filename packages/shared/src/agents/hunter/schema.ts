import { z } from 'zod';
import { BaseFinding } from '../core/schema-core';

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
