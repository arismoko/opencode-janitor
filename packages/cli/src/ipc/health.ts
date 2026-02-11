import { requestJson } from './client';
import type { ErrorResponse, HealthResponse } from './protocol';

export async function isRunning(socketPath: string): Promise<boolean> {
  try {
    const response = await requestJson<HealthResponse | ErrorResponse>({
      socketPath,
      path: '/v1/health',
      method: 'GET',
      timeoutMs: 750,
    });

    return response.status === 200;
  } catch {
    return false;
  }
}
