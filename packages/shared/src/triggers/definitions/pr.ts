import { z } from 'zod';
import type { TriggerDefinition } from '../types';

const PrTriggerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSec: z.number().int().min(1).default(30),
  ttlSec: z.number().int().min(1).default(300),
});

const PrTriggerStateSchema = z.object({
  lastPrKey: z.string().optional(),
  nextCheckAt: z.number().int().optional(),
  lastCheckedAt: z.number().int().optional(),
});

const PrTriggerPayloadSchema = z.object({
  prNumber: z.number().int().positive(),
  key: z.string().min(1),
  sha: z.string().optional(),
});

export const PR_TRIGGER_DEFINITION: TriggerDefinition<
  'pr',
  'pr',
  z.infer<typeof PrTriggerStateSchema>,
  z.infer<typeof PrTriggerPayloadSchema>,
  z.infer<typeof PrTriggerConfigSchema>
> = {
  id: 'pr',
  label: 'Pull Request',
  description: 'Automatically detects open pull request updates.',
  mode: 'auto',
  configSchema: PrTriggerConfigSchema,
  stateSchema: PrTriggerStateSchema,
  payloadSchema: PrTriggerPayloadSchema,
  defaultScope: 'pr',
  allowedScopes: ['pr'],
  buildSubject: (payload) => payload.key,
  buildTriggerContext: async ({ payload, subject }) => ({
    trigger: 'pr',
    subject,
    metadata: [`PR #${payload.prNumber}`],
    sha: payload.sha,
    prNumber: payload.prNumber,
  }),
};
