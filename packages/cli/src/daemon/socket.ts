import { chmodSync } from 'node:fs';
import type { EventRow } from '../db/models';
import type { EventFilterParams, EventRowWithSession } from '../db/queries';
import { toEventEntry } from '../ipc/event-entry';
import type {
  DaemonStatusResponse,
  DashboardReportDetailResponse,
  DashboardSnapshotResponse,
  DeleteReportResponse,
  EnqueueReviewRequest,
  EnqueueReviewResponse,
  ErrorResponse,
  EventsResponse,
  HealthResponse,
  StopResponse,
} from '../ipc/protocol';

const VALID_AGENT_NAMES = new Set(['janitor', 'hunter', 'inspector', 'scribe']);

export interface DaemonStatusSnapshot {
  pid: number;
  version: string;
  uptimeMs: number;
  draining: boolean;
  socketPath: string;
  dbPath: string;
  webHost: string;
  webPort: number;
}

export interface SocketServerOptions {
  socketPath: string;
  getStatus: () => DaemonStatusSnapshot;
  onStopRequested: () => void;
  onEnqueueReview: (
    request: EnqueueReviewRequest,
  ) => Promise<EnqueueReviewResponse>;
  listEventsAfterSeq: (afterSeq: number, limit: number) => EventRow[];
  listEventsAfterSeqFiltered: (
    afterSeq: number,
    limit: number,
    filters?: EventFilterParams,
  ) => EventRowWithSession[];
  getDashboardSnapshot: (
    eventsLimit: number,
    reportsLimit: number,
  ) => DashboardSnapshotResponse;
  getDashboardReportDetail: (
    agentRunId: string,
    findingsLimit: number,
  ) => DashboardReportDetailResponse | null;
  onDeleteReport: (agentRunId: string) => DeleteReportResponse;
}

const SSE_ENCODER = new TextEncoder();

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

/** Parse optional string filter query params from URL. */
export function parseFilterParams(url: URL): EventFilterParams {
  const filters: EventFilterParams = {};
  const repoId = url.searchParams.get('repoId');
  const jobId = url.searchParams.get('jobId');
  const agentRunId = url.searchParams.get('agentRunId');
  const topic = url.searchParams.get('topic');
  const sessionId = url.searchParams.get('sessionId');
  if (repoId) filters.repoId = repoId;
  if (jobId) filters.jobId = jobId;
  if (agentRunId) filters.agentRunId = agentRunId;
  if (topic) filters.topic = topic;
  if (sessionId) filters.sessionId = sessionId;
  return filters;
}

/**
 * Shared API request handler.
 * Used by both the Unix socket server and the TCP web server.
 */
export function handleApiRequest(
  request: Request,
  url: URL,
  options: SocketServerOptions,
): Response | Promise<Response> | null {
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
      webHost: status.webHost,
      webPort: status.webPort,
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
        return errorResponse(400, 'INVALID_BODY', 'Request body must be JSON');
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

      const agent =
        body && typeof body === 'object' && 'agent' in body
          ? (body as { agent?: unknown }).agent
          : undefined;

      if (typeof agent !== 'string' || agent.trim().length === 0) {
        return errorResponse(
          400,
          'INVALID_AGENT',
          '`agent` is required and must be one of janitor, hunter, inspector, scribe',
        );
      }

      const validAgent = agent.trim();

      if (!VALID_AGENT_NAMES.has(validAgent)) {
        return errorResponse(
          400,
          'INVALID_AGENT',
          '`agent` must be one of janitor, hunter, inspector, scribe',
        );
      }

      const prRaw =
        body && typeof body === 'object' && 'pr' in body
          ? (body as { pr?: unknown }).pr
          : undefined;
      const pr =
        typeof prRaw === 'number' && Number.isInteger(prRaw) && prRaw > 0
          ? prRaw
          : undefined;

      if (prRaw !== undefined && !pr) {
        return errorResponse(
          400,
          'INVALID_PR',
          '`pr` must be a positive integer',
        );
      }

      try {
        const response = await options.onEnqueueReview({
          repoOrId,
          agent: validAgent,
          pr,
        });
        return json(200, response);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(400, 'ENQUEUE_FAILED', message);
      }
    })();
  }

  if (request.method === 'GET' && url.pathname === '/v1/events') {
    const afterSeq = parseQueryInt(url, 'afterSeq', 0, 0);
    const limit = parseQueryInt(url, 'limit', 100, 1);
    const boundedLimit = Math.min(limit, 500);
    const filters = parseFilterParams(url);

    const hasFilters = Object.keys(filters).length > 0;
    const events: EventsResponse['events'] = hasFilters
      ? options
          .listEventsAfterSeqFiltered(afterSeq, boundedLimit, filters)
          .map((row) => toEventEntry(row, row.session_id))
      : options
          .listEventsAfterSeq(afterSeq, boundedLimit)
          .map((row) => toEventEntry(row));

    const payload: EventsResponse = {
      ok: true,
      afterSeq,
      events,
    };
    return json(200, payload);
  }

  if (request.method === 'GET' && url.pathname === '/v1/events/stream') {
    // Determine initial cursor: query param > Last-Event-ID header > 0
    let initialAfterSeq = parseQueryInt(url, 'afterSeq', -1, 0);
    if (initialAfterSeq === -1) {
      const lastEventId = request.headers.get('Last-Event-ID');
      if (lastEventId) {
        const parsed = Number.parseInt(lastEventId, 10);
        initialAfterSeq = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      } else {
        initialAfterSeq = 0;
      }
    }
    const pollMs = parseQueryInt(url, 'pollMs', 500, 100);
    const filters = parseFilterParams(url);
    const hasFilters = Object.keys(filters).length > 0;

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
          if (hasFilters) {
            const rows = options.listEventsAfterSeqFiltered(
              cursor,
              200,
              filters,
            );
            if (rows.length === 0) {
              emitHeartbeat();
              return;
            }
            for (const row of rows) {
              cursor = row.seq;
              const entry = toEventEntry(row, row.session_id);
              controller.enqueue(sseChunk('event', entry));
            }
          } else {
            const rows = options.listEventsAfterSeq(cursor, 200);
            if (rows.length === 0) {
              emitHeartbeat();
              return;
            }
            for (const row of rows) {
              cursor = row.seq;
              const entry = toEventEntry(row);
              controller.enqueue(sseChunk('event', entry));
            }
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

  if (request.method === 'GET' && url.pathname === '/v1/dashboard/snapshot') {
    const eventsLimit = parseQueryInt(url, 'eventsLimit', 80, 1);
    const reportsLimit = parseQueryInt(url, 'reportsLimit', 40, 1);
    const boundedEventsLimit = Math.min(eventsLimit, 500);
    const boundedReportsLimit = Math.min(reportsLimit, 200);
    return json(
      200,
      options.getDashboardSnapshot(boundedEventsLimit, boundedReportsLimit),
    );
  }

  if (request.method === 'GET' && url.pathname === '/v1/dashboard/report') {
    const agentRunId = url.searchParams.get('agentRunId');
    if (!agentRunId || agentRunId.trim().length === 0) {
      return errorResponse(
        400,
        'INVALID_AGENT_RUN_ID',
        '`agentRunId` query param is required',
      );
    }

    const findingsLimit = parseQueryInt(url, 'findingsLimit', 120, 1);
    const boundedFindingsLimit = Math.min(findingsLimit, 500);
    const detail = options.getDashboardReportDetail(
      agentRunId,
      boundedFindingsLimit,
    );
    if (!detail) {
      return errorResponse(404, 'NOT_FOUND', 'Report not found');
    }
    return json(200, detail);
  }

  if (request.method === 'DELETE' && url.pathname === '/v1/dashboard/report') {
    return (async () => {
      let body: unknown;

      try {
        body = await request.json();
      } catch {
        return errorResponse(400, 'INVALID_BODY', 'Request body must be JSON');
      }

      const agentRunId =
        body && typeof body === 'object' && 'agentRunId' in body
          ? (body as { agentRunId?: unknown }).agentRunId
          : undefined;

      if (typeof agentRunId !== 'string' || agentRunId.trim().length === 0) {
        return errorResponse(
          400,
          'INVALID_AGENT_RUN_ID',
          '`agentRunId` must be a non-empty string',
        );
      }

      try {
        const response = options.onDeleteReport(agentRunId);
        return json(200, response);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(400, 'DELETE_FAILED', message);
      }
    })();
  }

  // Not handled by the API
  return null;
}

export function createSocketServer(
  options: SocketServerOptions,
): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    unix: options.socketPath,
    fetch(request) {
      const url = new URL(request.url);
      const result = handleApiRequest(request, url, options);
      if (result) return result;

      return errorResponse(404, 'NOT_FOUND', 'Endpoint not found', {
        method: request.method,
        path: url.pathname,
      });
    },
  });

  try {
    chmodSync(options.socketPath, 0o600);
  } catch {
    // Socket may not support chmod on all platforms; best-effort.
  }

  return server;
}
