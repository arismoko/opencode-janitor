import { json } from '../http/response';
import type { CapabilitiesApi, Route } from '../socket-types';

export function createCapabilitiesRoutes(
  capabilities: CapabilitiesApi,
): Route[] {
  return [
    {
      method: 'GET',
      path: '/v1/capabilities',
      handler: () => json(200, capabilities.getCapabilities()),
    },
  ];
}
