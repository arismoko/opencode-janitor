import { z } from 'zod';
import { AGENT_IDS } from '../../agents';
import type { TriggerDefinition } from '../types';

const ManualTriggerConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

const ManualTriggerStateSchema = z.object({});

const ManualTriggerPayloadSchema = z.object({
  agent: z.enum(AGENT_IDS).optional(),
  requestedScope: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  note: z.string().optional(),
  sha: z.string().optional(),
  prNumber: z.number().int().positive().optional(),
});

export const MANUAL_TRIGGER_DEFINITION: TriggerDefinition<
  'manual',
  'commit-diff' | 'workspace-diff' | 'repo' | 'pr',
  z.infer<typeof ManualTriggerStateSchema>,
  z.infer<typeof ManualTriggerPayloadSchema>,
  z.infer<typeof ManualTriggerConfigSchema>
> = {
  id: 'manual',
  label: 'Manual',
  description: 'Manual review requests from CLI and dashboard entrypoints.',
  mode: 'manual',
  configSchema: ManualTriggerConfigSchema,
  stateSchema: ManualTriggerStateSchema,
  payloadSchema: ManualTriggerPayloadSchema,
  defaultScope: null,
  allowedScopes: ['commit-diff', 'workspace-diff', 'repo', 'pr'],
  buildSubject: (payload) => {
    const requestedScope = payload.requestedScope ?? 'auto';
    const prSuffix =
      payload.prNumber !== undefined ? `:pr-${payload.prNumber}` : '';
    return `manual:${requestedScope}${prSuffix}`;
  },
  buildTriggerContext: async ({ payload, subject }) => {
    const metadata = ['Manual request'];

    if (payload.requestedScope) {
      metadata.push(`Requested scope: ${payload.requestedScope}`);
    }

    if (payload.note) {
      metadata.push(`Note: ${payload.note}`);
    }

    return {
      trigger: 'manual',
      subject,
      metadata,
      sha: payload.sha,
      prNumber: payload.prNumber,
    };
  },
};
