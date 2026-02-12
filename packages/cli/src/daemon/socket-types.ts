import type { EventRow } from '../db/models';
import type {
  EventFilterParams,
  EventRowWithSession,
} from '../db/queries/event-queries';
import type {
  CapabilitiesResponse,
  CommentPrRequest,
  CommentPrResponse,
  DashboardReportDetailResponse,
  DashboardSnapshotResponse,
  DeleteReportResponse,
  EnqueueReviewRequest,
  EnqueueReviewResponse,
  GetPrDetailRequest,
  GetPrDetailResponse,
  ListPrsRequest,
  ListPrsResponse,
  MergePrRequest,
  MergePrResponse,
  ReplyReviewCommentRequest,
  ReplyReviewCommentResponse,
  RequestReviewersRequest,
  RequestReviewersResponse,
  ResumeReviewRequest,
  ResumeReviewResponse,
  StopReviewRequest,
  StopReviewResponse,
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
  onStopReview: (request: StopReviewRequest) => Promise<StopReviewResponse>;
  onResumeReview: (
    request: ResumeReviewRequest,
  ) => Promise<ResumeReviewResponse>;
}

export interface EventApi {
  listEventsAfterSeq: (afterSeq: number, limit: number) => EventRow[];
  listEventsAfterSeqFiltered: (
    afterSeq: number,
    limit: number,
    filters?: EventFilterParams,
  ) => EventRowWithSession[];
  clearEvents: () => { deleted: number };
}

export interface DashboardApi {
  getDashboardSnapshot: (
    eventsLimit: number,
    reportsLimit: number,
  ) => DashboardSnapshotResponse;
  getDashboardReportDetail: (
    reviewRunId: string,
    findingsLimit: number,
  ) => DashboardReportDetailResponse | null;
  onDeleteReport: (reviewRunId: string) => DeleteReportResponse;
}

export interface CapabilitiesApi {
  getCapabilities: () => CapabilitiesResponse;
}

export interface PrApi {
  listPrs: (request: ListPrsRequest) => Promise<ListPrsResponse>;
  getPrDetail: (request: GetPrDetailRequest) => Promise<GetPrDetailResponse>;
  mergePr: (request: MergePrRequest) => Promise<MergePrResponse>;
  commentPr: (request: CommentPrRequest) => Promise<CommentPrResponse>;
  requestReviewers: (
    request: RequestReviewersRequest,
  ) => Promise<RequestReviewersResponse>;
  replyReviewComment: (
    request: ReplyReviewCommentRequest,
  ) => Promise<ReplyReviewCommentResponse>;
}

export interface SocketServerOptions {
  socketPath: string;
  lifecycle: LifecycleApi;
  review: ReviewApi;
  event: EventApi;
  dashboard: DashboardApi;
  capabilities: CapabilitiesApi;
  pr: PrApi;
}

export interface Route {
  method: string;
  path: string;
  handler: (request: Request, url: URL) => Response | Promise<Response>;
}
