import { isScopeId, MANUAL_TRIGGER_DEFINITION } from '@opencode-janitor/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const MANUAL_TRIGGER_MODULE = {
  ...MANUAL_TRIGGER_DEFINITION,
  /**
   * Coerce raw user input (from CLI / dashboard) into a validated manual
   * payload.  Maps the user-facing `scope` field to the schema's
   * `requestedScope` before delegating to the shared
   * ManualTriggerPayloadSchema for validation.
   */
  fromManualRequest: async (input: unknown) => {
    if (!isRecord(input)) {
      return {};
    }

    // Map user-facing 'scope' to schema's 'requestedScope'.
    const mapped: Record<string, unknown> = { ...input };
    if (typeof mapped.scope === 'string' && isScopeId(mapped.scope.trim())) {
      mapped.requestedScope = mapped.scope.trim();
    }

    const result = MANUAL_TRIGGER_DEFINITION.payloadSchema.safeParse(mapped);
    return result.success ? result.data : {};
  },
};
