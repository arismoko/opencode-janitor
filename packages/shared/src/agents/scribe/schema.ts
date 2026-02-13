import { z } from 'zod';
import { BaseFinding } from '../core/schema-core';

export const SCRIBE_DOMAIN_VALUES = ['DRIFT', 'GAP', 'RELEASE'] as const;
export const ScribeDomain = z.enum(SCRIBE_DOMAIN_VALUES).catch('GAP');
export type ScribeDomain = z.infer<typeof ScribeDomain>;

export const SCRIBE_DOC_TYPE_VALUES = [
  'README',
  'API_REFERENCE',
  'CHANGELOG',
  'CONFIG_GUIDE',
  'MIGRATION_GUIDE',
  'TUTORIAL',
  'INLINE_COMMENT',
  'TYPE_DOC',
  'OTHER',
] as const;
export const ScribeDocType = z.enum(SCRIBE_DOC_TYPE_VALUES);
export type ScribeDocType = z.infer<typeof ScribeDocType>;

export const SCRIBE_STALENESS_VALUES = [
  'CURRENT',
  'STALE',
  'OBSOLETE',
  'MISSING',
] as const;
export const ScribeStaleness = z.enum(SCRIBE_STALENESS_VALUES);
export type ScribeStaleness = z.infer<typeof ScribeStaleness>;

export const ScribeDocAlignment = z.object({
  docType: ScribeDocType,
  staleness: ScribeStaleness,
  docSource: z
    .string()
    .min(1)
    .describe('The doc file and section that is wrong or missing'),
  codeSource: z
    .string()
    .min(1)
    .describe('The code symbol or file that is the source of truth'),
  discrepancy: z
    .string()
    .min(1)
    .describe('What the doc says vs what the code actually does'),
});
export type ScribeDocAlignment = z.infer<typeof ScribeDocAlignment>;

export const ScribeFinding = BaseFinding.extend({
  domain: ScribeDomain,
  docAlignment: ScribeDocAlignment,
});
export type ScribeFinding = z.infer<typeof ScribeFinding>;

export const ScribeOutput = z.object({
  findings: z.array(ScribeFinding),
});
export type ScribeOutput = z.infer<typeof ScribeOutput>;
