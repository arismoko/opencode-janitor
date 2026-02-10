/**
 * TCP HTTP server for the web dashboard.
 *
 * Serves the frontend SPA at `/` and proxies API routes to the shared handler.
 * Adds CORS headers so the browser can talk to the API.
 */
import { getDashboardHtml } from './frontend';
import {
  errorResponse,
  handleApiRequest,
  type SocketServerOptions,
} from './socket';

export interface WebServerOptions {
  hostname: string;
  port: number;
  apiOptions: SocketServerOptions;
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, last-event-id',
};

function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

let cachedHtml: string | null = null;

export function createWebServer(
  options: WebServerOptions,
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: options.hostname,
    port: options.port,
    fetch(request) {
      const url = new URL(request.url);

      // CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // Serve frontend SPA
      if (
        request.method === 'GET' &&
        (url.pathname === '/' || url.pathname === '/index.html')
      ) {
        if (!cachedHtml) {
          cachedHtml = getDashboardHtml();
        }
        return new Response(cachedHtml, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-cache',
          },
        });
      }

      // API routes
      const apiResult = handleApiRequest(request, url, options.apiOptions);
      if (apiResult) {
        if (apiResult instanceof Promise) {
          return apiResult.then(withCors);
        }
        return withCors(apiResult);
      }

      return withCors(
        errorResponse(404, 'NOT_FOUND', 'Endpoint not found', {
          method: request.method,
          path: url.pathname,
        }),
      );
    },
  });
}
