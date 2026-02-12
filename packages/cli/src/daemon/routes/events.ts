import type { EventFilterParams } from '../../db/queries/event-queries';
import { toEventEntry } from '../../ipc/event-entry';
import type { EventsResponse } from '../../ipc/protocol';
import { errorResponse, json, sseChunk } from '../http/response';
import { parseFilterParams, parseQueryInt } from '../http/validation';
import type { EventApi, Route } from '../socket-types';

function loadEventEntries(
  eventApi: EventApi,
  afterSeq: number,
  limit: number,
  filters?: EventFilterParams,
): { entries: EventsResponse['events']; lastSeq: number } {
  const hasFilters = Boolean(filters && Object.keys(filters).length > 0);

  if (hasFilters) {
    const rows = eventApi.listEventsAfterSeqFiltered(afterSeq, limit, filters);
    return {
      entries: rows.map((row) => toEventEntry(row, row.session_id)),
      lastSeq: rows.at(-1)?.seq ?? afterSeq,
    };
  }

  const rows = eventApi.listEventsAfterSeq(afterSeq, limit);
  return {
    entries: rows.map((row) => toEventEntry(row)),
    lastSeq: rows.at(-1)?.seq ?? afterSeq,
  };
}

function handleEvents(url: URL, eventApi: EventApi): Response {
  const afterSeq = parseQueryInt(url, 'afterSeq', 0, 0);
  const limit = parseQueryInt(url, 'limit', 100, 1);
  const boundedLimit = Math.min(limit, 500);
  const filters = parseFilterParams(url);
  const { entries } = loadEventEntries(
    eventApi,
    afterSeq,
    boundedLimit,
    filters,
  );

  const payload: EventsResponse = {
    ok: true,
    afterSeq,
    events: entries,
  };
  return json(200, payload);
}

function handleClearEvents(eventApi: EventApi): Response {
  const { deleted } = eventApi.clearEvents();
  return json(200, { ok: true, deleted });
}

function handleEventsStream(
  request: Request,
  url: URL,
  eventApi: EventApi,
): Response {
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

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let cursor = initialAfterSeq;
      let closed = false;

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
          clearInterval(interval);
        }
      };

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
        safeEnqueue(sseChunk('ready', { afterSeq: cursor }));
      };

      const emitHeartbeat = () => {
        safeEnqueue(
          sseChunk('heartbeat', { afterSeq: cursor, ts: Date.now() }),
        );
      };

      const emitEvents = () => {
        const { entries, lastSeq } = loadEventEntries(
          eventApi,
          cursor,
          200,
          filters,
        );
        if (entries.length === 0) {
          emitHeartbeat();
          return;
        }
        cursor = lastSeq;
        for (const entry of entries) {
          safeEnqueue(sseChunk('event', entry));
        }
      };

      const interval = setInterval(() => {
        if (closed) return;
        try {
          emitEvents();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          safeEnqueue(sseChunk('error', { message }));
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

export function createEventRoutes(eventApi: EventApi): Route[] {
  return [
    {
      method: 'GET',
      path: '/v1/events',
      handler: (_request, url) => handleEvents(url, eventApi),
    },
    {
      method: 'DELETE',
      path: '/v1/events',
      handler: () => handleClearEvents(eventApi),
    },
    {
      method: 'GET',
      path: '/v1/events/stream',
      handler: (request, url) => handleEventsStream(request, url, eventApi),
    },
  ];
}
