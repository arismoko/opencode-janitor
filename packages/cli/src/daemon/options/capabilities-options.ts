import { buildCapabilitiesView } from '@opencode-janitor/shared';
import type { CapabilitiesApi } from '../socket-types';

export function createCapabilitiesOptions(): CapabilitiesApi {
  return {
    getCapabilities: () => ({
      ok: true,
      generatedAt: Date.now(),
      ...buildCapabilitiesView(),
    }),
  };
}
