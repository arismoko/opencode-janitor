import {
  AGENT_NAMES,
  type AgentName,
  isScopeId,
  type ScopeId,
} from '@opencode-janitor/shared';

export interface CommitJobPayload {
  sha: string;
}

export interface PrJobPayload {
  prNumber: number;
  sha: string;
}

export interface ManualJobPayload {
  agent: AgentName;
  requestedScope?: ScopeId;
  input?: Record<string, unknown>;
  note?: string;
  sha?: string;
  prNumber?: number;
}

export type ReviewJobPayload =
  | CommitJobPayload
  | PrJobPayload
  | ManualJobPayload;

export function buildCommitPayload(sha: string): CommitJobPayload {
  return { sha };
}

export function buildPrPayload(prNumber: number, sha: string): PrJobPayload {
  return { prNumber, sha };
}

export function buildPrPayloadFromKey(prKey: string): PrJobPayload {
  const [numberRaw, shaRaw] = prKey.split(':');
  const prNumber = Number.parseInt(numberRaw ?? '', 10);
  const sha = (shaRaw ?? '').trim();

  if (!Number.isInteger(prNumber) || prNumber <= 0 || sha.length === 0) {
    throw new Error(`Invalid PR key payload: "${prKey}"`);
  }

  return buildPrPayload(prNumber, sha);
}

export function buildManualPayload(payload: {
  agent: AgentName;
  requestedScope?: ScopeId;
  input?: Record<string, unknown>;
  note?: string;
  sha?: string;
  prNumber?: number;
}): ManualJobPayload {
  return {
    agent: payload.agent,
    ...(payload.requestedScope
      ? { requestedScope: payload.requestedScope }
      : {}),
    ...(payload.input ? { input: payload.input } : {}),
    ...(payload.note ? { note: payload.note } : {}),
    ...(payload.sha ? { sha: payload.sha } : {}),
    ...(payload.prNumber !== undefined ? { prNumber: payload.prNumber } : {}),
  };
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('payload must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid review job payload JSON: ${error.message}`);
    }
    throw new Error('Invalid review job payload JSON');
  }
}

function parseRequiredString(
  payload: Record<string, unknown>,
  field: string,
): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Invalid review job payload: \`${field}\` must be a string`,
    );
  }
  return value.trim();
}

function parseOptionalPositiveInt(
  payload: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Invalid review job payload: \`${field}\` must be a positive integer`,
    );
  }
  return value;
}

function parseOptionalScopeId(
  payload: Record<string, unknown>,
  field: string,
): ScopeId | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isScopeId(value)) {
    throw new Error(
      `Invalid review job payload: \`${field}\` must be one of commit-diff, workspace-diff, repo, pr`,
    );
  }
  return value;
}

function parseOptionalRecord(
  payload: Record<string, unknown>,
  field: string,
): Record<string, unknown> | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `Invalid review job payload: \`${field}\` must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function parseOptionalString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Invalid review job payload: \`${field}\` must be a string`,
    );
  }
  return value.trim();
}

function parseAgent(payload: Record<string, unknown>): AgentName {
  const value = parseRequiredString(payload, 'agent');
  if (!AGENT_NAMES.includes(value as AgentName)) {
    throw new Error('Invalid review job payload: `agent` is not recognized');
  }
  return value as AgentName;
}

export function parseReviewJobPayload(
  raw: string,
  kind: 'commit' | 'pr' | 'manual',
): ReviewJobPayload {
  const payload = parseObject(raw);

  if (kind === 'commit') {
    return buildCommitPayload(parseRequiredString(payload, 'sha'));
  }

  if (kind === 'pr') {
    return buildPrPayload(
      parseOptionalPositiveInt(payload, 'prNumber') ??
        (() => {
          throw new Error(
            'Invalid review job payload: `prNumber` is required for pr jobs',
          );
        })(),
      parseRequiredString(payload, 'sha'),
    );
  }

  return buildManualPayload({
    agent: parseAgent(payload),
    requestedScope: parseOptionalScopeId(payload, 'requestedScope'),
    input: parseOptionalRecord(payload, 'input'),
    note: parseOptionalString(payload, 'note'),
    sha: parseOptionalString(payload, 'sha'),
    prNumber: parseOptionalPositiveInt(payload, 'prNumber'),
  });
}
