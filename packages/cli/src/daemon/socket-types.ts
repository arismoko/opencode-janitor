import type { EventRow } from '../db/models';
import type {
  EventFilterParams,
  EventRowWithSession,
} from '../db/queries/event-queries';
import type {
  DashboardReportDetailResponse,
  DashboardSnapshotResponse,
  DeleteReportResponse,
  EnqueueReviewRequest,
  EnqueueReviewResponse,
} from '../ipc/protocol';

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

export interface LifecycleApi {
  getStatus: () => DaemonStatusSnapshot;
  onStopRequested: () => void;
}

export interface ReviewApi {
  onEnqueueReview: (
    request: EnqueueReviewRequest,
  ) => Promise<EnqueueReviewResponse>;
}

export interface EventApi {
  listEventsAfterSeq: (afterSeq: number, limit: number) => EventRow[];
  listEventsAfterSeqFiltered: (
    afterSeq: number,
    limit: number,
    filters?: EventFilterParams,
  ) => EventRowWithSession[];
}

export interface DashboardApi {
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

export interface SocketServerOptions {
  socketPath: string;
  lifecycle: LifecycleApi;
  review: ReviewApi;
  event: EventApi;
  dashboard: DashboardApi;
}

export interface Route {
  method: string;
  path: string;
  handler: (request: Request, url: URL) => Response | Promise<Response>;
}
