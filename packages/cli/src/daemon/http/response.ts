import type { ErrorResponse } from '../../ipc/protocol';

const SSE_ENCODER = new TextEncoder();

export function sseChunk(event: string, payload: unknown): Uint8Array {
  return SSE_ENCODER.encode(
    `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
}

export function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  const payload: ErrorResponse = {
    error: { code, message, details },
  };
  return json(status, payload);
}
