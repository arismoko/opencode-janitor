import type { z } from 'zod';

export type TriggerProbeResult<TState, TPayload> = {
  nextState: TState;
  emissions: Array<{
    eventKey: string;
    payload: TPayload;
    detectedAt: number;
  }>;
};

export type TriggerContext<TTriggerId extends string = string> = {
  trigger: TTriggerId;
  subject: string;
  metadata: string[];
  sha?: string;
  prNumber?: number;
};

export type TriggerDefinition<
  TTriggerId extends string = string,
  TScopeId extends string = string,
  TState = unknown,
  TPayload = unknown,
  TConfig = unknown,
> = {
  id: TTriggerId;
  label: string;
  description: string;
  mode: 'auto' | 'manual' | 'both';
  configSchema: z.ZodType<TConfig>;
  stateSchema: z.ZodType<TState>;
  payloadSchema: z.ZodType<TPayload>;
  defaultScope: TScopeId | null;
  allowedScopes: readonly TScopeId[];
  probe?: (input: {
    repoPath: string;
    state: TState;
    config: TConfig;
  }) => Promise<TriggerProbeResult<TState, TPayload>>;
  fromManualRequest?: (input: unknown, repoPath: string) => Promise<TPayload>;
  buildSubject: (payload: TPayload) => string;
  buildTriggerContext: (input: {
    repoPath: string;
    payload: TPayload;
    subject: string;
  }) => Promise<TriggerContext<TTriggerId>>;
};
