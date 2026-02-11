import { MANUAL_TRIGGER_DEFINITION } from '@opencode-janitor/shared';

type ManualPayload = {
  requestedScope?: string;
  input?: Record<string, unknown>;
  note?: string;
  sha?: string;
  prNumber?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const MANUAL_TRIGGER_MODULE = {
  ...MANUAL_TRIGGER_DEFINITION,
  fromManualRequest: async (input: unknown): Promise<ManualPayload> => {
    if (!isRecord(input)) {
      return {};
    }

    const payload: ManualPayload = {};

    if (typeof input.scope === 'string' && input.scope.trim().length > 0) {
      payload.requestedScope = input.scope;
    }

    if (isRecord(input.input)) {
      payload.input = input.input;
    }

    if (typeof input.note === 'string' && input.note.trim().length > 0) {
      payload.note = input.note;
    }

    if (typeof input.sha === 'string' && input.sha.trim().length > 0) {
      payload.sha = input.sha;
    }

    if (
      typeof input.prNumber === 'number' &&
      Number.isInteger(input.prNumber)
    ) {
      payload.prNumber = input.prNumber;
    }

    return payload;
  },
};
