import type {
  DaemonStatusResponse,
  ErrorResponse,
  HealthResponse,
  StopResponse,
} from '../ipc/protocol';

export interface DaemonStatusSnapshot {
  pid: number;
  version: string;
  uptimeMs: number;
  draining: boolean;
  socketPath: string;
  dbPath: string;
}

export interface SocketServerOptions {
  socketPath: string;
  getStatus: () => DaemonStatusSnapshot;
  onStopRequested: () => void;
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(
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

export function createSocketServer(
  options: SocketServerOptions,
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    unix: options.socketPath,
    fetch(request) {
      const url = new URL(request.url);
      const status = options.getStatus();

      if (request.method === 'GET' && url.pathname === '/v1/health') {
        const payload: HealthResponse = {
          ok: true,
          pid: status.pid,
          version: status.version,
          uptimeMs: status.uptimeMs,
        };
        return json(200, payload);
      }

      if (request.method === 'GET' && url.pathname === '/v1/daemon/status') {
        const payload: DaemonStatusResponse = {
          ok: true,
          pid: status.pid,
          uptimeMs: status.uptimeMs,
          draining: status.draining,
          socketPath: status.socketPath,
          dbPath: status.dbPath,
        };
        return json(200, payload);
      }

      if (request.method === 'POST' && url.pathname === '/v1/daemon/stop') {
        setTimeout(() => {
          options.onStopRequested();
        }, 25);

        const payload: StopResponse = {
          ok: true,
          draining: true,
        };

        return json(200, payload);
      }

      return errorResponse(404, 'NOT_FOUND', 'Endpoint not found', {
        method: request.method,
        path: url.pathname,
      });
    },
  });
}
