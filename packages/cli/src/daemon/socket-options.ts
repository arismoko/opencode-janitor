import type { RuntimeContext } from '../runtime/context';
import { createCapabilitiesOptions } from './options/capabilities-options';
import { createDashboardOptions } from './options/dashboard-options';
import { createEventOptions } from './options/event-options';
import { createReviewOptions } from './options/review-options';
import type {
  DaemonStatusSnapshot,
  LifecycleApi,
  SocketServerOptions,
} from './socket-types';

export function createLifecycleOptions(
  statusSnapshot: () => DaemonStatusSnapshot,
  shutdown: () => void,
): LifecycleApi {
  return {
    getStatus: statusSnapshot,
    onStopRequested: shutdown,
  };
}

export function createSocketOptions(
  rc: RuntimeContext,
  statusSnapshot: () => DaemonStatusSnapshot,
  shutdown: () => void,
): SocketServerOptions {
  return {
    socketPath: rc.config.daemon.socketPath,
    lifecycle: createLifecycleOptions(statusSnapshot, shutdown),
    review: createReviewOptions(rc),
    event: createEventOptions(rc),
    dashboard: createDashboardOptions(rc, statusSnapshot),
    capabilities: createCapabilitiesOptions(),
  };
}
