import type {
  DaemonStatusResponse,
  EnqueueReviewRequest,
  EnqueueReviewResponse,
  ErrorResponse,
  EventsResponse,
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
  onEnqueueReview: (
    request: EnqueueReviewRequest,
  ) => Promise<EnqueueReviewResponse>;
  listEventsAfterSeq: (
    afterSeq: number,
    limit: number,
  ) => EventsResponse['events'];
}

const SSE_ENCODER = new TextEncoder();

function parseQueryInt(
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

function sseChunk(event: string, payload: unknown): Uint8Array {
  return SSE_ENCODER.encode(
    `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
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

      if (request.method === 'POST' && url.pathname === '/v1/reviews/enqueue') {
        return (async () => {
          let body: unknown;

          try {
            body = await request.json();
          } catch {
            return errorResponse(
              400,
              'INVALID_BODY',
              'Request body must be JSON',
            );
          }

          const repoOrId =
            body && typeof body === 'object' && 'repoOrId' in body
              ? (body as { repoOrId?: unknown }).repoOrId
              : undefined;

          if (typeof repoOrId !== 'string' || repoOrId.trim().length === 0) {
            return errorResponse(
              400,
              'INVALID_REPO',
              '`repoOrId` must be a non-empty string',
            );
          }

          try {
            const response = await options.onEnqueueReview({ repoOrId });
            return json(200, response);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return errorResponse(400, 'ENQUEUE_FAILED', message);
          }
        })();
      }

      if (request.method === 'GET' && url.pathname === '/v1/events') {
        const afterSeq = parseQueryInt(url, 'afterSeq', 0, 0);
        const limit = parseQueryInt(url, 'limit', 100, 1);
        const boundedLimit = Math.min(limit, 500);

        const payload: EventsResponse = {
          ok: true,
          afterSeq,
          events: options.listEventsAfterSeq(afterSeq, boundedLimit),
        };
        return json(200, payload);
      }

      if (request.method === 'GET' && url.pathname === '/v1/events/stream') {
        const initialAfterSeq = parseQueryInt(url, 'afterSeq', 0, 0);
        const pollMs = parseQueryInt(url, 'pollMs', 500, 100);

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            let cursor = initialAfterSeq;
            let closed = false;

            const close = () => {
              if (closed) return;
              closed = true;
              clearInterval(interval);
              try {
                controller.close();
              } catch {
                // ignore close race
              }
            };

            const emitReady = () => {
              controller.enqueue(sseChunk('ready', { afterSeq: cursor }));
            };

            const emitHeartbeat = () => {
              controller.enqueue(
                sseChunk('heartbeat', { afterSeq: cursor, ts: Date.now() }),
              );
            };

            const emitEvents = () => {
              const events = options.listEventsAfterSeq(cursor, 200);
              if (events.length === 0) {
                emitHeartbeat();
                return;
              }

              for (const event of events) {
                cursor = event.seq;
                controller.enqueue(sseChunk('event', event));
              }
            };

            const interval = setInterval(() => {
              try {
                emitEvents();
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                controller.enqueue(sseChunk('error', { message }));
              }
            }, pollMs);

            emitReady();

            if (request.signal.aborted) {
              close();
              return;
            }

            request.signal.addEventListener('abort', close, { once: true });
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          },
        });
      }

      return errorResponse(404, 'NOT_FOUND', 'Endpoint not found', {
        method: request.method,
        path: url.pathname,
      });
    },
  });
}
