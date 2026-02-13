/**
 * TCP HTTP server for the web dashboard.
 *
 * Serves the frontend SPA at `/` and proxies API routes to the shared handler.
 *
 * Security:
 * - CORS is restricted to the dashboard's own origin (same-origin).
 * - Mutating endpoints (POST, DELETE) require a Bearer auth token.
 * - GET endpoints are open (read-only, informational).
 */

import { toWebUrl } from '../utils/web-url';
import type { DevWatcher } from './dev-watcher';
import { getDashboardHtml, getFrontendAsset } from './frontend';
import {
  buildRouteMap,
  errorResponse,
  handleApiRequest,
  type SocketServerOptions,
} from './socket';

export interface WebServerOptions {
  hostname: string;
  port: number;
  apiOptions: SocketServerOptions;
  /** Auth token for mutating endpoints. If omitted, auth is disabled. */
  authToken?: string;
  /** Dev-mode watcher for live reload. Enables SSE reload endpoint. */
  devWatcher?: DevWatcher;
}

/** Methods that mutate state and require auth. */
const MUTATING_METHODS = new Set(['POST', 'DELETE']);

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost'
  );
}

function buildCorsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers':
      'content-type, authorization, last-event-id',
  };
}

function withCors(
  response: Response,
  corsHeaders: Record<string, string>,
): Response {
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * Check the Authorization header for a valid Bearer token.
 * Returns null if valid, or an error Response if invalid.
 */
function checkAuth(request: Request, expectedToken: string): Response | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return errorResponse(401, 'UNAUTHORIZED', 'Missing Authorization header');
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== expectedToken) {
    return errorResponse(401, 'UNAUTHORIZED', 'Invalid auth token');
  }

  return null;
}

let cachedHtml: string | null = null;

/**
 * Build the inline JS snippet that subscribes to the dev live-reload SSE
 * stream and triggers a full page refresh on `reload` events.
 *
 * The script relies on the browser's built-in EventSource reconnection
 * behavior for transient errors — it must NOT call `es.close()` on error,
 * otherwise a single blip permanently disables live reload.
 */
export function buildDevReloadScript(): string {
  return '(function(){try{var es=new EventSource("/_dev/live-reload");es.addEventListener("reload",function(){window.location.reload()})}catch(e){}})()';
}

/**
 * Handle the `/_dev/live-reload` SSE endpoint.
 *
 * Registers the client's stream controller with the dev watcher so it
 * receives `reload` events when files change.
 */
function handleLiveReload(request: Request, devWatcher: DevWatcher): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      devWatcher.addClient(controller);

      const cleanup = () => {
        devWatcher.removeClient(controller);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      if (request.signal.aborted) {
        cleanup();
        return;
      }

      request.signal.addEventListener('abort', cleanup, { once: true });
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

export function createWebServer(
  options: WebServerOptions,
): ReturnType<typeof Bun.serve> {
  if (options.authToken && !isLoopbackHost(options.hostname)) {
    throw new Error(
      `Refusing to start web dashboard on non-loopback host with auth enabled: ${options.hostname}. Use 127.0.0.1, ::1, or localhost.`,
    );
  }

  const origin = toWebUrl(options.hostname, options.port);
  const corsHeaders = buildCorsHeaders(origin);
  const routeMap = buildRouteMap(options.apiOptions);

  return Bun.serve({
    hostname: options.hostname,
    port: options.port,
    fetch(request) {
      const url = new URL(request.url);

      // CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Dev-mode live-reload SSE stream
      if (
        request.method === 'GET' &&
        url.pathname === '/_dev/live-reload' &&
        options.devWatcher
      ) {
        return handleLiveReload(request, options.devWatcher);
      }

      // Serve frontend SPA (inject auth token and dev-mode reload script)
      if (
        request.method === 'GET' &&
        (url.pathname === '/' || url.pathname === '/index.html')
      ) {
        // In dev mode, bypass local cache — frontend.ts cache is invalidated
        // by the watcher, so getDashboardHtml() re-reads from disk.
        const baseHtml = options.devWatcher
          ? getDashboardHtml()
          : (cachedHtml ??= getDashboardHtml());

        // Inject the auth token into the page so the SPA can use it.
        const tokenScript = options.authToken
          ? `<script>window.__JANITOR_AUTH_TOKEN__=${JSON.stringify(options.authToken)};</script>`
          : '';

        // In dev mode, inject a live-reload listener script.
        const devScript = options.devWatcher
          ? `<script>${buildDevReloadScript()}</script>`
          : '';

        const html = baseHtml.replace(
          '</head>',
          `${tokenScript}${devScript}</head>`,
        );
        return new Response(html, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-cache',
          },
        });
      }

      if (request.method === 'GET' && url.pathname.startsWith('/_dashboard/')) {
        const asset = getFrontendAsset(url.pathname);
        if (asset) {
          return new Response(asset.body, {
            status: 200,
            headers: {
              'content-type': asset.contentType,
              'cache-control': 'no-cache',
            },
          });
        }
      }

      // Auth gate: require Bearer token on mutating endpoints
      if (options.authToken && MUTATING_METHODS.has(request.method)) {
        const authError = checkAuth(request, options.authToken);
        if (authError) {
          return withCors(authError, corsHeaders);
        }
      }

      // API routes
      const apiResult = handleApiRequest(request, url, routeMap);
      if (apiResult) {
        if (apiResult instanceof Promise) {
          return apiResult.then((r) => withCors(r, corsHeaders));
        }
        return withCors(apiResult, corsHeaders);
      }

      return withCors(
        errorResponse(404, 'NOT_FOUND', 'Endpoint not found', {
          method: request.method,
          path: url.pathname,
        }),
        corsHeaders,
      );
    },
  });
}
