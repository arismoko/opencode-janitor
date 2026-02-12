import { z } from 'zod';
import { BaseFinding } from '../core/schema-core';

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
