import {
  AGENT_NAMES,
  type AgentName,
  isScopeId,
  type ScopeId,
} from '@opencode-janitor/shared';
import type { EventFilterParams } from '../../db/queries/event-queries';

const VALID_AGENT_NAMES = new Set<string>(AGENT_NAMES);

export type ValidationErrorCode =
  | 'INVALID_BODY'
  | 'INVALID_REPO'
  | 'INVALID_AGENT'
  | 'INVALID_SCOPE'
  | 'INVALID_SCOPE_INPUT'
  | 'INVALID_PR'
  | 'INVALID_REVIEW_RUN_ID';

export class ValidationError extends Error {
  readonly code: ValidationErrorCode;
  readonly field?: string;

  constructor(code: ValidationErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.field = field;
  }
}

export function parseQueryInt(
  url: URL,
  key: string,
  fallback: number,
  minimum = 0,
): number {
  const raw = url.searchParams.get(key);
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.max(parsed, minimum);
}

export function parseFilterParams(url: URL): EventFilterParams {
  const filters: EventFilterParams = {};
  const repoId = url.searchParams.get('repoId');
  const triggerEventId = url.searchParams.get('triggerEventId');
  const reviewRunId = url.searchParams.get('reviewRunId');
  const topic = url.searchParams.get('topic');
  const sessionId = url.searchParams.get('sessionId');
  if (repoId) filters.repoId = repoId;
  if (triggerEventId) filters.triggerEventId = triggerEventId;
  if (reviewRunId) filters.reviewRunId = reviewRunId;
  if (topic) filters.topic = topic;
  if (sessionId) filters.sessionId = sessionId;
  return filters;
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError(
      'INVALID_BODY',
      'Request body must be valid JSON',
    );
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const code =
      field === 'repoOrId'
        ? 'INVALID_REPO'
        : field === 'reviewRunId'
          ? 'INVALID_REVIEW_RUN_ID'
          : 'INVALID_BODY';
    throw new ValidationError(
      code,
      `\`${field}\` must be a non-empty string`,
      field,
    );
  }
  return value.trim();
}

export function requirePositiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(
      'INVALID_PR',
      `\`${field}\` must be a positive integer`,
      field,
    );
  }
  return value;
}

export function requireScopeId(value: unknown): ScopeId {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(
      'INVALID_SCOPE',
      '`scope` must be a non-empty string',
      'scope',
    );
  }

  const scope = value.trim();
  if (!isScopeId(scope)) {
    throw new ValidationError(
      'INVALID_SCOPE',
      '`scope` must be one of commit-diff, workspace-diff, repo, pr',
      'scope',
    );
  }

  return scope;
}

export function requireRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      'INVALID_SCOPE_INPUT',
      `\`${field}\` must be an object`,
      field,
    );
  }

  return value as Record<string, unknown>;
}

export function getBodyField(body: unknown, field: string): unknown {
  if (!body || typeof body !== 'object') return undefined;
  if (!(field in body)) return undefined;
  return (body as Record<string, unknown>)[field];
}

export function requireAgentName(value: unknown): AgentName {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(
      'INVALID_AGENT',
      '`agent` must be a non-empty string',
      'agent',
    );
  }
  const agent = value.trim();
  if (!VALID_AGENT_NAMES.has(agent)) {
    throw new ValidationError(
      'INVALID_AGENT',
      `\`agent\` must be one of ${AGENT_NAMES.join(', ')}`,
      'agent',
    );
  }
  return agent as AgentName;
}
