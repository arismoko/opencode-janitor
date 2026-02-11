import { describe, expect, it, mock } from 'bun:test';
import { AGENT_IDS } from '@opencode-janitor/shared';
import type { EventRow } from '../db/models';
import type {
  EventFilterParams,
  EventRowWithSession,
} from '../db/queries/event-queries';
import type { EnqueueReviewRequest } from '../ipc/protocol';
import {
  type DaemonStatusSnapshot,
  errorResponse,
  handleApiRequest,
  json,
  parseFilterParams,
  parseQueryInt,
  type SocketServerOptions,
  sseChunk,
} from './socket';
import type {
  CapabilitiesApi,
  DashboardApi,
  EventApi,
  LifecycleApi,
  ReviewApi,
} from './socket-types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function stubStatus(): DaemonStatusSnapshot {
  return {
    pid: 1234,
    version: '0.1.0',
    uptimeMs: 60_000,
    draining: false,
    socketPath: '/tmp/test.sock',
    dbPath: '/tmp/test.db',
    webHost: '127.0.0.1',
    webPort: 7700,
  };
}

function makeEventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    seq: 1,
    ts: Date.now(),
    level: 'info',
    event_type: 'test.event',
    repo_id: 'repo-1',
    job_id: 'job-1',
    agent_run_id: 'run-1',
    trigger_event_id: 'event-1',
    review_run_id: 'rrn-1',
    message: 'test event',
    payload_json: '{}',
    ...overrides,
  };
}

function makeEventRowWithSession(
  overrides: Partial<EventRowWithSession> = {},
): EventRowWithSession {
  return {
    ...makeEventRow(),
    session_id: 'session-1',
    ...overrides,
  };
}

interface SocketServerOverrides {
  socketPath?: string;
  lifecycle?: Partial<LifecycleApi>;
  review?: Partial<ReviewApi>;
  event?: Partial<EventApi>;
  dashboard?: Partial<DashboardApi>;
  capabilities?: Partial<CapabilitiesApi>;
}

function stubOptions(
  overrides: SocketServerOverrides = {},
): SocketServerOptions {
  const base: SocketServerOptions = {
    socketPath: '/tmp/test.sock',
    lifecycle: {
      getStatus: () => stubStatus(),
      onStopRequested: mock(() => {}),
    },
    review: {
      onEnqueueReview: mock(async (req: EnqueueReviewRequest) => ({
        ok: true as const,
        enqueued: true,
        repoId: 'repo-1',
        repoPath: '/tmp/repo',
        sha: 'abc123',
        subjectKey: `${req.agent}:${req.repoOrId}`,
      })),
    },
    event: {
      listEventsAfterSeq: mock((_afterSeq: number, _limit: number) => [
        makeEventRow(),
      ]),
      listEventsAfterSeqFiltered: mock(
        (
          _afterSeq: number,
          _limit: number,
          _filters?: EventFilterParams,
        ): EventRowWithSession[] => [makeEventRowWithSession()],
      ),
    },
    dashboard: {
      getDashboardSnapshot: mock(
        (_eventsLimit: number, _reportsLimit: number) => ({
          ok: true as const,
          generatedAt: Date.now(),
          latestSeq: 1,
          daemon: {
            pid: 1234,
            uptimeMs: 60_000,
            draining: false,
            socketPath: '/tmp/test.sock',
            dbPath: '/tmp/test.db',
          },
          repos: [],
          agents: [],
          reports: [],
          events: [],
        }),
      ),
      getDashboardReportDetail: mock(
        (_agentRunId: string, _findingsLimit: number) => null,
      ),
      onDeleteReport: mock((_agentRunId: string) => ({
        ok: true as const,
        deleted: true,
        agentRunId: _agentRunId,
      })),
    },
    capabilities: {
      getCapabilities: mock(() => ({
        ok: true as const,
        generatedAt: Date.now(),
        agents: [],
        scopes: [],
        triggers: [],
      })),
    },
  };

  return {
    ...base,
    ...overrides,
    lifecycle: { ...base.lifecycle, ...(overrides.lifecycle ?? {}) },
    review: { ...base.review, ...(overrides.review ?? {}) },
    event: { ...base.event, ...(overrides.event ?? {}) },
    dashboard: { ...base.dashboard, ...(overrides.dashboard ?? {}) },
    capabilities: { ...base.capabilities, ...(overrides.capabilities ?? {}) },
  };
}

function makeRequest(
  method: string,
  urlStr: string,
  body?: unknown,
): { request: Request; url: URL } {
  const url = new URL(urlStr, 'http://localhost');
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return { request: new Request(url.toString(), init), url };
}

/** Make a request with a raw (non-JSON) string body. */
function makeRawRequest(
  method: string,
  urlStr: string,
  rawBody: string,
): { request: Request; url: URL } {
  const url = new URL(urlStr, 'http://localhost');
  return {
    request: new Request(url.toString(), {
      method,
      body: rawBody,
      headers: { 'content-type': 'application/json' },
    }),
    url,
  };
}

async function getJsonBody(response: Response): Promise<unknown> {
  return response.json();
}

// ---------------------------------------------------------------------------
// 1. parseQueryInt — bounded query params
// ---------------------------------------------------------------------------

describe('parseQueryInt', () => {
  it('returns fallback when key is absent', () => {
    const url = new URL('http://localhost/test');
    expect(parseQueryInt(url, 'limit', 100)).toBe(100);
  });

  it('returns fallback for non-numeric string', () => {
    const url = new URL('http://localhost/test?limit=abc');
    expect(parseQueryInt(url, 'limit', 100)).toBe(100);
  });

  it('returns fallback for NaN', () => {
    const url = new URL('http://localhost/test?limit=NaN');
    expect(parseQueryInt(url, 'limit', 100)).toBe(100);
  });

  it('returns fallback for Infinity', () => {
    const url = new URL('http://localhost/test?limit=Infinity');
    expect(parseQueryInt(url, 'limit', 100)).toBe(100);
  });

  it('parses valid integer', () => {
    const url = new URL('http://localhost/test?limit=50');
    expect(parseQueryInt(url, 'limit', 100)).toBe(50);
  });

  it('clamps to minimum (default 0)', () => {
    const url = new URL('http://localhost/test?limit=-5');
    expect(parseQueryInt(url, 'limit', 100)).toBe(0);
  });

  it('clamps to custom minimum', () => {
    const url = new URL('http://localhost/test?limit=0');
    expect(parseQueryInt(url, 'limit', 100, 1)).toBe(1);
  });

  it('allows value exactly at minimum', () => {
    const url = new URL('http://localhost/test?limit=1');
    expect(parseQueryInt(url, 'limit', 100, 1)).toBe(1);
  });

  it('allows value above minimum', () => {
    const url = new URL('http://localhost/test?limit=10');
    expect(parseQueryInt(url, 'limit', 100, 1)).toBe(10);
  });

  it('returns fallback for empty string', () => {
    const url = new URL('http://localhost/test?limit=');
    expect(parseQueryInt(url, 'limit', 100)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 2. parseFilterParams — event stream filtering
// ---------------------------------------------------------------------------

describe('parseFilterParams', () => {
  it('returns empty object for no filter params', () => {
    const url = new URL('http://localhost/v1/events');
    expect(parseFilterParams(url)).toEqual({});
  });

  it('parses repoId filter', () => {
    const url = new URL('http://localhost/v1/events?repoId=repo-1');
    expect(parseFilterParams(url)).toEqual({ repoId: 'repo-1' });
  });

  it('parses multiple filters', () => {
    const url = new URL(
      'http://localhost/v1/events?repoId=repo-1&jobId=job-1&topic=review',
    );
    expect(parseFilterParams(url)).toEqual({
      repoId: 'repo-1',
      jobId: 'job-1',
      topic: 'review',
    });
  });

  it('parses all five filter params', () => {
    const url = new URL(
      'http://localhost/v1/events?repoId=r&jobId=j&agentRunId=a&topic=t&sessionId=s',
    );
    expect(parseFilterParams(url)).toEqual({
      repoId: 'r',
      jobId: 'j',
      agentRunId: 'a',
      topic: 't',
      sessionId: 's',
    });
  });

  it('ignores empty string values', () => {
    const url = new URL('http://localhost/v1/events?repoId=&jobId=job-1');
    expect(parseFilterParams(url)).toEqual({ jobId: 'job-1' });
  });

  it('ignores unknown params', () => {
    const url = new URL('http://localhost/v1/events?unknown=value');
    expect(parseFilterParams(url)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 3. sseChunk — SSE formatting
// ---------------------------------------------------------------------------

describe('sseChunk', () => {
  it('encodes SSE event with JSON payload', () => {
    const chunk = sseChunk('event', { seq: 1 });
    const decoded = new TextDecoder().decode(chunk);
    expect(decoded).toBe('event: event\ndata: {"seq":1}\n\n');
  });

  it('encodes heartbeat event', () => {
    const chunk = sseChunk('heartbeat', { ts: 123 });
    const decoded = new TextDecoder().decode(chunk);
    expect(decoded).toBe('event: heartbeat\ndata: {"ts":123}\n\n');
  });
});

// ---------------------------------------------------------------------------
// 4. json helper
// ---------------------------------------------------------------------------

describe('json helper', () => {
  it('returns Response with status and JSON content-type', async () => {
    const resp = json(200, { ok: true });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toBe('application/json');
    expect(await resp.json()).toEqual({ ok: true });
  });

  it('returns error status code', async () => {
    const resp = json(400, { error: 'bad' });
    expect(resp.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 5. errorResponse helper
// ---------------------------------------------------------------------------

describe('errorResponse helper', () => {
  it('formats ErrorResponse payload', async () => {
    const resp = errorResponse(400, 'INVALID_BODY', 'bad json');
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('INVALID_BODY');
    expect(body.error.message).toBe('bad json');
  });

  it('includes details when provided', async () => {
    const resp = errorResponse(404, 'NOT_FOUND', 'nope', { path: '/x' });
    const body = (await resp.json()) as {
      error: { details: { path: string } };
    };
    expect(body.error.details).toEqual({ path: '/x' });
  });
});

// ---------------------------------------------------------------------------
// 6. handleApiRequest — Unknown routes return null
// ---------------------------------------------------------------------------

describe('handleApiRequest — unknown routes', () => {
  it('returns null for unknown path', () => {
    const { request, url } = makeRequest('GET', '/v1/nonexistent');
    const result = handleApiRequest(request, url, stubOptions());
    expect(result).toBeNull();
  });

  it('returns null for root path', () => {
    const { request, url } = makeRequest('GET', '/');
    const result = handleApiRequest(request, url, stubOptions());
    expect(result).toBeNull();
  });

  it('returns null for partial match path', () => {
    const { request, url } = makeRequest('GET', '/v1/review');
    const result = handleApiRequest(request, url, stubOptions());
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. handleApiRequest — Method validation
// ---------------------------------------------------------------------------

describe('handleApiRequest — method validation', () => {
  it('returns null for POST to GET-only /v1/health', () => {
    const { request, url } = makeRequest('POST', '/v1/health');
    const result = handleApiRequest(request, url, stubOptions());
    expect(result).toBeNull();
  });

  it('returns null for GET to POST-only /v1/reviews/enqueue', () => {
    const { request, url } = makeRequest('GET', '/v1/reviews/enqueue');
    const result = handleApiRequest(request, url, stubOptions());
    expect(result).toBeNull();
  });

  it('returns null for GET to POST-only /v1/daemon/stop', () => {
    const { request, url } = makeRequest('GET', '/v1/daemon/stop');
    const result = handleApiRequest(request, url, stubOptions());
    expect(result).toBeNull();
  });

  it('returns null for POST to GET-only /v1/events', () => {
    const { request, url } = makeRequest('POST', '/v1/events');
    const result = handleApiRequest(request, url, stubOptions());
    expect(result).toBeNull();
  });

  it('returns null for POST to GET-only /v1/daemon/status', () => {
    const { request, url } = makeRequest('POST', '/v1/daemon/status');
    const result = handleApiRequest(request, url, stubOptions());
    expect(result).toBeNull();
  });

  it('returns null for PUT to /v1/dashboard/report', () => {
    const { request, url } = makeRequest('PUT', '/v1/dashboard/report');
    const result = handleApiRequest(request, url, stubOptions());
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. /v1/reviews/enqueue — input validation
// ---------------------------------------------------------------------------

describe('POST /v1/reviews/enqueue — input validation', () => {
  it('accepts valid request with repoOrId and agent', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: 'my-repo',
      agent: 'janitor',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { ok: boolean; enqueued: boolean };
    expect(body.ok).toBe(true);
    expect(body.enqueued).toBe(true);
  });

  it('accepts valid request with scope/input fields', async () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: 'my-repo',
      agent: 'hunter',
      scope: 'pr',
      input: { prNumber: 42 },
    });
    const resp = (await handleApiRequest(request, url, opts)) as Response;
    expect(resp.status).toBe(200);
    // Verify scope/input were passed through
    expect(opts.review.onEnqueueReview).toHaveBeenCalledWith({
      repoOrId: 'my-repo',
      agent: 'hunter',
      scope: 'pr',
      input: { prNumber: 42 },
    });
  });

  it('rejects missing repoOrId', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      agent: 'janitor',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REPO');
  });

  it('rejects empty repoOrId', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: '',
      agent: 'janitor',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REPO');
  });

  it('rejects whitespace-only repoOrId', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: '   ',
      agent: 'janitor',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REPO');
  });

  it('rejects non-string repoOrId', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: 123,
      agent: 'janitor',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REPO');
  });

  it('rejects missing agent', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: 'my-repo',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_AGENT');
  });

  it('rejects empty agent', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: 'my-repo',
      agent: '',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_AGENT');
  });

  it('rejects unknown agent name', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: 'my-repo',
      agent: 'terminator',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_AGENT');
  });

  it('accepts all four valid agent names', async () => {
    for (const agent of AGENT_IDS) {
      const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
        repoOrId: 'my-repo',
        agent,
      });
      const resp = (await handleApiRequest(
        request,
        url,
        stubOptions(),
      )) as Response;
      expect(resp.status).toBe(200);
    }
  });

  it('rejects unknown scope', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: 'my-repo',
      agent: 'hunter',
      scope: 'not-a-scope',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_SCOPE');
  });

  it('rejects non-object input', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: 'my-repo',
      agent: 'hunter',
      input: 'bad',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_SCOPE_INPUT');
  });

  it('rejects note when not a string', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: 'my-repo',
      agent: 'hunter',
      note: 123,
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_BODY');
  });

  it('accepts undefined scope/input (optional fields)', async () => {
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: 'my-repo',
      agent: 'janitor',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(200);
  });

  it('surfaces onEnqueueReview errors as 400', async () => {
    const opts = stubOptions({
      review: {
        onEnqueueReview: mock(async () => {
          throw new Error('Repo not found');
        }),
      },
    });
    const { request, url } = makeRequest('POST', '/v1/reviews/enqueue', {
      repoOrId: 'unknown-repo',
      agent: 'janitor',
    });
    const resp = (await handleApiRequest(request, url, opts)) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('ENQUEUE_FAILED');
    expect(body.error.message).toBe('Repo not found');
  });
});

// ---------------------------------------------------------------------------
// 9. /v1/reviews/enqueue — invalid JSON body
// ---------------------------------------------------------------------------

describe('POST /v1/reviews/enqueue — invalid JSON body', () => {
  it('returns 400 INVALID_BODY for malformed JSON', async () => {
    const { request, url } = makeRawRequest(
      'POST',
      '/v1/reviews/enqueue',
      '{ not valid json',
    );
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_BODY');
  });

  it('returns 400 INVALID_BODY for empty body', async () => {
    const { request, url } = makeRawRequest('POST', '/v1/reviews/enqueue', '');
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    // Empty body triggers json() parse error => INVALID_BODY
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_BODY');
  });
});

describe('GET /v1/capabilities', () => {
  it('returns capabilities payload', async () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('GET', '/v1/capabilities');
    const resp = handleApiRequest(request, url, opts) as Response;
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      ok: boolean;
      agents: unknown[];
      scopes: unknown[];
      triggers: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.agents)).toBe(true);
    expect(Array.isArray(body.scopes)).toBe(true);
    expect(Array.isArray(body.triggers)).toBe(true);
    expect(opts.capabilities.getCapabilities).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 10. GET /v1/health — success path
// ---------------------------------------------------------------------------

describe('GET /v1/health', () => {
  it('returns health response with pid and version', async () => {
    const { request, url } = makeRequest('GET', '/v1/health');
    const resp = handleApiRequest(request, url, stubOptions()) as Response;
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      ok: boolean;
      pid: number;
      version: string;
      uptimeMs: number;
    };
    expect(body.ok).toBe(true);
    expect(body.pid).toBe(1234);
    expect(body.version).toBe('0.1.0');
    expect(body.uptimeMs).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// 11. GET /v1/daemon/status
// ---------------------------------------------------------------------------

describe('GET /v1/daemon/status', () => {
  it('returns full daemon status', async () => {
    const { request, url } = makeRequest('GET', '/v1/daemon/status');
    const resp = handleApiRequest(request, url, stubOptions()) as Response;
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      ok: boolean;
      pid: number;
      draining: boolean;
      socketPath: string;
      webPort: number;
    };
    expect(body.ok).toBe(true);
    expect(body.pid).toBe(1234);
    expect(body.draining).toBe(false);
    expect(body.socketPath).toBe('/tmp/test.sock');
    expect(body.webPort).toBe(7700);
  });
});

// ---------------------------------------------------------------------------
// 12. POST /v1/daemon/stop
// ---------------------------------------------------------------------------

describe('POST /v1/daemon/stop', () => {
  it('returns stop response', async () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('POST', '/v1/daemon/stop');
    const resp = handleApiRequest(request, url, opts) as Response;
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { ok: boolean; draining: boolean };
    expect(body.ok).toBe(true);
    expect(body.draining).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. GET /v1/events — bounded query params
// ---------------------------------------------------------------------------

describe('GET /v1/events — bounded query params', () => {
  it('uses default limit=100 and afterSeq=0', async () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('GET', '/v1/events');
    const resp = handleApiRequest(request, url, opts) as Response;
    expect(resp.status).toBe(200);
    // With no filters, calls listEventsAfterSeq
    expect(opts.event.listEventsAfterSeq).toHaveBeenCalledWith(0, 100);
  });

  it('caps limit at 500', async () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('GET', '/v1/events?limit=9999');
    handleApiRequest(request, url, opts);
    expect(opts.event.listEventsAfterSeq).toHaveBeenCalledWith(0, 500);
  });

  it('uses provided afterSeq', async () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('GET', '/v1/events?afterSeq=50');
    handleApiRequest(request, url, opts);
    expect(opts.event.listEventsAfterSeq).toHaveBeenCalledWith(50, 100);
  });

  it('clamps negative afterSeq to 0', async () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('GET', '/v1/events?afterSeq=-10');
    handleApiRequest(request, url, opts);
    expect(opts.event.listEventsAfterSeq).toHaveBeenCalledWith(0, 100);
  });

  it('clamps limit below minimum to 1', async () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('GET', '/v1/events?limit=0');
    handleApiRequest(request, url, opts);
    expect(opts.event.listEventsAfterSeq).toHaveBeenCalledWith(0, 1);
  });

  it('responds with ok, afterSeq, and events array', async () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('GET', '/v1/events?afterSeq=5');
    const resp = handleApiRequest(request, url, opts) as Response;
    const body = (await resp.json()) as {
      ok: boolean;
      afterSeq: number;
      events: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.afterSeq).toBe(5);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 14. GET /v1/events — filter routing
// ---------------------------------------------------------------------------

describe('GET /v1/events — filter routing', () => {
  it('uses listEventsAfterSeq when no filters present', () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('GET', '/v1/events');
    handleApiRequest(request, url, opts);
    expect(opts.event.listEventsAfterSeq).toHaveBeenCalled();
    expect(opts.event.listEventsAfterSeqFiltered).not.toHaveBeenCalled();
  });

  it('uses listEventsAfterSeqFiltered when filters present', () => {
    const opts = stubOptions();
    const { request, url } = makeRequest(
      'GET',
      '/v1/events?repoId=repo-1&jobId=job-1',
    );
    handleApiRequest(request, url, opts);
    expect(opts.event.listEventsAfterSeqFiltered).toHaveBeenCalled();
    expect(opts.event.listEventsAfterSeq).not.toHaveBeenCalled();
  });

  it('passes filter params through to listEventsAfterSeqFiltered', () => {
    const opts = stubOptions();
    const { request, url } = makeRequest(
      'GET',
      '/v1/events?repoId=r1&topic=review.started&afterSeq=10&limit=50',
    );
    handleApiRequest(request, url, opts);
    expect(opts.event.listEventsAfterSeqFiltered).toHaveBeenCalledWith(10, 50, {
      repoId: 'r1',
      topic: 'review.started',
    });
  });
});

// ---------------------------------------------------------------------------
// 15. GET /v1/dashboard/snapshot — bounded params
// ---------------------------------------------------------------------------

describe('GET /v1/dashboard/snapshot', () => {
  it('uses default limits', async () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('GET', '/v1/dashboard/snapshot');
    const resp = handleApiRequest(request, url, opts) as Response;
    expect(resp.status).toBe(200);
    expect(opts.dashboard.getDashboardSnapshot).toHaveBeenCalledWith(80, 40);
  });

  it('caps eventsLimit at 500 and reportsLimit at 200', () => {
    const opts = stubOptions();
    const { request, url } = makeRequest(
      'GET',
      '/v1/dashboard/snapshot?eventsLimit=9999&reportsLimit=9999',
    );
    handleApiRequest(request, url, opts);
    expect(opts.dashboard.getDashboardSnapshot).toHaveBeenCalledWith(500, 200);
  });

  it('accepts custom limits within bounds', () => {
    const opts = stubOptions();
    const { request, url } = makeRequest(
      'GET',
      '/v1/dashboard/snapshot?eventsLimit=20&reportsLimit=10',
    );
    handleApiRequest(request, url, opts);
    expect(opts.dashboard.getDashboardSnapshot).toHaveBeenCalledWith(20, 10);
  });
});

// ---------------------------------------------------------------------------
// 16. GET /v1/dashboard/report
// ---------------------------------------------------------------------------

describe('GET /v1/dashboard/report', () => {
  it('rejects missing agentRunId', async () => {
    const { request, url } = makeRequest('GET', '/v1/dashboard/report');
    const resp = handleApiRequest(request, url, stubOptions()) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_AGENT_RUN_ID');
  });

  it('rejects empty agentRunId', async () => {
    const { request, url } = makeRequest(
      'GET',
      '/v1/dashboard/report?agentRunId=',
    );
    const resp = handleApiRequest(request, url, stubOptions()) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_AGENT_RUN_ID');
  });

  it('returns 404 when report not found', async () => {
    const opts = stubOptions({
      dashboard: {
        getDashboardReportDetail: mock(() => null),
      },
    });
    const { request, url } = makeRequest(
      'GET',
      '/v1/dashboard/report?agentRunId=nonexistent',
    );
    const resp = handleApiRequest(request, url, opts) as Response;
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('caps findingsLimit at 500', () => {
    const opts = stubOptions();
    const { request, url } = makeRequest(
      'GET',
      '/v1/dashboard/report?agentRunId=run-1&findingsLimit=9999',
    );
    handleApiRequest(request, url, opts);
    expect(opts.dashboard.getDashboardReportDetail).toHaveBeenCalledWith(
      'run-1',
      500,
    );
  });
});

// ---------------------------------------------------------------------------
// 17. DELETE /v1/dashboard/report — input validation
// ---------------------------------------------------------------------------

describe('DELETE /v1/dashboard/report', () => {
  it('rejects invalid JSON body', async () => {
    const { request, url } = makeRawRequest(
      'DELETE',
      '/v1/dashboard/report',
      '{ broken',
    );
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_BODY');
  });

  it('rejects missing agentRunId in body', async () => {
    const { request, url } = makeRequest('DELETE', '/v1/dashboard/report', {});
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_AGENT_RUN_ID');
  });

  it('rejects empty agentRunId in body', async () => {
    const { request, url } = makeRequest('DELETE', '/v1/dashboard/report', {
      agentRunId: '',
    });
    const resp = (await handleApiRequest(
      request,
      url,
      stubOptions(),
    )) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_AGENT_RUN_ID');
  });

  it('succeeds with valid agentRunId', async () => {
    const opts = stubOptions();
    const { request, url } = makeRequest('DELETE', '/v1/dashboard/report', {
      agentRunId: 'run-42',
    });
    const resp = (await handleApiRequest(request, url, opts)) as Response;
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      ok: boolean;
      deleted: boolean;
      agentRunId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(true);
    expect(body.agentRunId).toBe('run-42');
  });

  it('surfaces onDeleteReport errors as 400', async () => {
    const opts = stubOptions({
      dashboard: {
        onDeleteReport: mock(() => {
          throw new Error('DB error');
        }),
      },
    });
    const { request, url } = makeRequest('DELETE', '/v1/dashboard/report', {
      agentRunId: 'run-1',
    });
    const resp = (await handleApiRequest(request, url, opts)) as Response;
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('DELETE_FAILED');
    expect(body.error.message).toBe('DB error');
  });
});

// ---------------------------------------------------------------------------
// 18. GET /v1/events/stream — SSE streaming basics
// ---------------------------------------------------------------------------

describe('GET /v1/events/stream', () => {
  it('returns SSE response with correct headers', () => {
    const { request, url } = makeRequest('GET', '/v1/events/stream');
    const resp = handleApiRequest(request, url, stubOptions()) as Response;
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toBe('text/event-stream');
    expect(resp.headers.get('cache-control')).toBe('no-cache');
    expect(resp.headers.get('connection')).toBe('keep-alive');
  });

  it('emits ready event as first chunk', async () => {
    const opts = stubOptions({
      event: {
        listEventsAfterSeq: mock(() => []),
      },
    });
    const { request, url } = makeRequest('GET', '/v1/events/stream?afterSeq=5');
    const resp = handleApiRequest(request, url, opts) as Response;
    const reader = resp.body!.getReader();
    const { value } = await reader.read();
    const decoded = new TextDecoder().decode(value);
    expect(decoded).toContain('event: ready');
    expect(decoded).toContain('"afterSeq":5');
    // Cancel to stop the interval
    await reader.cancel();
  });

  it('uses Last-Event-ID header when afterSeq param absent', async () => {
    const opts = stubOptions({
      event: {
        listEventsAfterSeq: mock(() => []),
      },
    });
    const url = new URL('http://localhost/v1/events/stream');
    const request = new Request(url.toString(), {
      method: 'GET',
      headers: { 'Last-Event-ID': '42' },
    });
    const resp = handleApiRequest(request, url, opts) as Response;
    const reader = resp.body!.getReader();
    const { value } = await reader.read();
    const decoded = new TextDecoder().decode(value);
    expect(decoded).toContain('"afterSeq":42');
    await reader.cancel();
  });

  it('afterSeq query param takes precedence over Last-Event-ID', async () => {
    const opts = stubOptions({
      event: {
        listEventsAfterSeq: mock(() => []),
      },
    });
    const url = new URL('http://localhost/v1/events/stream?afterSeq=10');
    const request = new Request(url.toString(), {
      method: 'GET',
      headers: { 'Last-Event-ID': '99' },
    });
    const resp = handleApiRequest(request, url, opts) as Response;
    const reader = resp.body!.getReader();
    const { value } = await reader.read();
    const decoded = new TextDecoder().decode(value);
    expect(decoded).toContain('"afterSeq":10');
    await reader.cancel();
  });
});
