import { z } from 'zod';
import type { TriggerDefinition } from '../types';

const CommitTriggerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSec: z.number().int().min(1).default(15),
});

const CommitTriggerStateSchema = z.object({
  lastHeadSha: z.string().optional(),
  nextCheckAt: z.number().int().optional(),
  lastCheckedAt: z.number().int().optional(),
});

const CommitTriggerPayloadSchema = z.object({
  sha: z.string().min(1),
});

export const COMMIT_TRIGGER_DEFINITION: TriggerDefinition<
  'commit',
  'commit-diff',
  z.infer<typeof CommitTriggerStateSchema>,
  z.infer<typeof CommitTriggerPayloadSchema>,
  z.infer<typeof CommitTriggerConfigSchema>
> = {
  id: 'commit',
  label: 'Commit',
  description: 'Automatically detects new commits on repository HEAD.',
  mode: 'auto',
  configSchema: CommitTriggerConfigSchema,
  stateSchema: CommitTriggerStateSchema,
  payloadSchema: CommitTriggerPayloadSchema,
  defaultScope: 'commit-diff',
  allowedScopes: ['commit-diff'],
  buildSubject: (payload) => payload.sha,
  buildTriggerContext: async ({ payload, subject }) => ({
    trigger: 'commit',
    subject,
    metadata: [`Commit SHA: ${payload.sha}`],
    sha: payload.sha,
  }),
};
