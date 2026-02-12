import { chmodSync } from 'node:fs';
import { errorResponse, json, sseChunk } from './http/response';
import { parseFilterParams, parseQueryInt } from './http/validation';
import { createCapabilitiesRoutes } from './routes/capabilities';
import { createDashboardRoutes } from './routes/dashboard';
import { createEventRoutes } from './routes/events';
import { createHealthRoutes } from './routes/health';
import { createPrRoutes } from './routes/prs';
import { createReviewRoutes } from './routes/reviews';
import type {
  DaemonStatusSnapshot,
  Route,
  SocketServerOptions,
} from './socket-types';

export { errorResponse, json, parseFilterParams, parseQueryInt, sseChunk };
export type { DaemonStatusSnapshot, SocketServerOptions };

export type RouteMap = Map<string, Route['handler']>;

export function buildRouteMap(options: SocketServerOptions): RouteMap {
  const routes: Route[] = [
    ...createHealthRoutes(options.lifecycle),
    ...createReviewRoutes(options.review),
    ...createEventRoutes(options.event),
    ...createDashboardRoutes(options.dashboard),
    ...createCapabilitiesRoutes(options.capabilities),
    ...createPrRoutes(options.pr),
  ];
  const map: RouteMap = new Map();
  for (const route of routes) {
    map.set(`${route.method}:${route.path}`, route.handler);
  }
  return map;
}

export function handleApiRequest(
  request: Request,
  url: URL,
  routeMapOrOptions: RouteMap | SocketServerOptions,
): Response | Promise<Response> | null {
  const map =
    routeMapOrOptions instanceof Map
      ? routeMapOrOptions
      : buildRouteMap(routeMapOrOptions);
  const handler = map.get(`${request.method}:${url.pathname}`);
  return handler ? handler(request, url) : null;
}

export function createSocketServer(
  options: SocketServerOptions,
): ReturnType<typeof Bun.serve> {
  const routeMap = buildRouteMap(options);

  const server = Bun.serve({
    unix: options.socketPath,
    fetch(request) {
      const url = new URL(request.url);
      const result = handleApiRequest(request, url, routeMap);
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
