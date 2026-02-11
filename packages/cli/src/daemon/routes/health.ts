import type {
  DaemonStatusResponse,
  HealthResponse,
  StopResponse,
} from '../../ipc/protocol';
import { json } from '../http/response';
import type { LifecycleApi, Route } from '../socket-types';

function handleHealth(lifecycle: LifecycleApi): Response {
  const status = lifecycle.getStatus();
  const payload: HealthResponse = {
    ok: true,
    pid: status.pid,
    version: status.version,
    uptimeMs: status.uptimeMs,
  };
  return json(200, payload);
}

function handleDaemonStatus(lifecycle: LifecycleApi): Response {
  const status = lifecycle.getStatus();
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

function handleDaemonStop(lifecycle: LifecycleApi): Response {
  setTimeout(() => {
    lifecycle.onStopRequested();
  }, 25);

  const payload: StopResponse = {
    ok: true,
    draining: true,
  };
  return json(200, payload);
}

export function createHealthRoutes(lifecycle: LifecycleApi): Route[] {
  return [
    {
      method: 'GET',
      path: '/v1/health',
      handler: () => handleHealth(lifecycle),
    },
    {
      method: 'GET',
      path: '/v1/daemon/status',
      handler: () => handleDaemonStatus(lifecycle),
    },
    {
      method: 'POST',
      path: '/v1/daemon/stop',
      handler: () => handleDaemonStop(lifecycle),
    },
  ];
}
