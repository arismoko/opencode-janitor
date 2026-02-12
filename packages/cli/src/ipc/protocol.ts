import type {
  AgentName,
  CapabilitiesView,
  ScopeId,
} from '@opencode-janitor/shared';

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface HealthResponse {
  ok: true;
  pid: number;
  version: string;
  uptimeMs: number;
}

export interface DaemonStatusResponse {
  ok: true;
  pid: number;
  uptimeMs: number;
  draining: boolean;
  socketPath: string;
  dbPath: string;
  webHost: string;
  webPort: number;
}

export interface StopResponse {
  ok: true;
  draining: true;
}

export interface EnqueueReviewRequest {
  repoOrId: string;
  /** Agent name to run. */
  agent: AgentName;
  /** Optional manual scope request (commit-diff/workspace-diff/repo/pr). */
  scope?: ScopeId;
  /** Optional scope-specific input object validated against scope schema. */
  input?: Record<string, unknown>;
  /** Optional freeform note carried in manual trigger payload metadata. */
  note?: string;
  /** Optional path/folder hint to focus during manual review. */
  focusPath?: string;
}

export interface DeleteReportRequest {
  reviewRunId: string;
}

export interface DeleteReportResponse {
  ok: true;
  deleted: boolean;
  reviewRunId: string;
}

export interface EnqueueReviewResponse {
  ok: true;
  enqueued: boolean;
  repoId: string;
  repoPath: string;
  sha: string;
  subject: string;
}

export interface StopReviewRequest {
  reviewRunId: string;
}

export interface StopReviewResponse {
  ok: true;
  stopped: boolean;
  reviewRunId: string;
  status?: 'cancelled';
}

export interface ResumeReviewRequest {
  reviewRunId: string;
}

export interface ResumeReviewResponse {
  ok: true;
  resumed: boolean;
  reviewRunId: string;
  status?: 'queued';
  errorCode?: 'NOT_RESUMABLE';
}

export interface EventJournalEntry {
  eventId: number;
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  topic: string;
  repoId: string | null;
  triggerEventId: string | null;
  reviewRunId: string | null;
  sessionId: string | null;
  message: string;
  payload: Record<string, unknown>;
}

export interface EventsResponse {
  ok: true;
  afterSeq: number;
  events: EventJournalEntry[];
}

// ---------------------------------------------------------------------------
// Dashboard snapshot types
// ---------------------------------------------------------------------------

export interface DashboardDaemonState {
  pid: number;
  uptimeMs: number;
  draining: boolean;
  socketPath: string;
  dbPath: string;
}

export interface DashboardRepoState {
  id: string;
  path: string;
  enabled: boolean;
  paused: boolean;
  defaultBranch: string;
  queuedJobs: number;
  runningJobs: number;
  latestEventTs: number | null;
}

export interface DashboardAgentState {
  agent: AgentName;
  queuedRuns: number;
  runningRuns: number;
  succeededRuns: number;
  failedRuns: number;
  lastFinishedAt: number | null;
}

export interface DashboardReportSummary {
  id: string;
  repoId: string;
  repoPath: string;
  triggerEventId: string;
  subject: string | null;
  agent: AgentName;
  sessionId: string | null;
  status:
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'skipped';
  outcome:
    | 'succeeded'
    | 'failed_transient'
    | 'failed_terminal'
    | 'cancelled'
    | null;
  findingsCount: number;
  p0Count: number;
  p1Count: number;
  p2Count: number;
  p3Count: number;
  startedAt: number | null;
  finishedAt: number | null;
  errorMessage: string | null;
}

export interface DashboardFinding {
  id: string;
  repoId: string;
  repoPath: string;
  triggerEventId: string;
  reviewRunId: string;
  agent: AgentName;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  domain: string;
  location: string;
  evidence: string;
  prescription: string;
  enrichments?: Array<{
    kind: string;
    version: number;
    payload: Record<string, unknown>;
    collapsed?: boolean;
  }>;
  createdAt: number;
}

export interface DashboardSnapshotResponse {
  ok: true;
  generatedAt: number;
  latestSeq: number;
  daemon: DashboardDaemonState;
  repos: DashboardRepoState[];
  agents: DashboardAgentState[];
  reports: DashboardReportSummary[];
  events: EventJournalEntry[];
}

export interface DashboardReportDetailResponse {
  ok: true;
  generatedAt: number;
  report: DashboardReportSummary;
  findings: DashboardFinding[];
  rawOutput: string | null;
}

export interface CapabilitiesResponse extends CapabilitiesView {
  ok: true;
  generatedAt: number;
}

export type PrListBucket =
  | 'all-open'
  | 'review-requested'
  | 'assigned'
  | 'created-by-me'
  | 'mentioned';

export interface PrSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  authorLogin: string | null;
  isDraft: boolean;
  reviewDecision: string | null;
  mergeable: string | null;
  updatedAt: string;
  requestedReviewers: string[];
}

export interface PrIssueComment {
  id: number;
  authorLogin: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface PrReviewComment {
  id: number;
  inReplyToId: number | null;
  authorLogin: string | null;
  body: string;
  path: string | null;
  line: number | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface PrDetail extends PrSummary {
  body: string;
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  merged: boolean;
  mergeStateStatus: string | null;
  issueComments: PrIssueComment[];
  reviewComments: PrReviewComment[];
}

export interface ListPrsRequest {
  repoOrId: string;
  bucket?: PrListBucket;
  query?: string;
  limit?: number;
}

export interface ListPrsResponse {
  ok: true;
  generatedAt: number;
  items: PrSummary[];
}

export interface GetPrDetailRequest {
  repoOrId: string;
  prNumber: number;
}

export interface GetPrDetailResponse {
  ok: true;
  generatedAt: number;
  detail: PrDetail;
}

export interface MergePrRequest {
  repoOrId: string;
  prNumber: number;
  method?: 'merge' | 'squash' | 'rebase';
}

export interface MergePrResponse {
  ok: true;
  merged: boolean;
  prNumber: number;
}

export interface CommentPrRequest {
  repoOrId: string;
  prNumber: number;
  body: string;
}

export interface CommentPrResponse {
  ok: true;
  commented: boolean;
  prNumber: number;
}

export interface RequestReviewersRequest {
  repoOrId: string;
  prNumber: number;
  reviewers: string[];
}

export interface RequestReviewersResponse {
  ok: true;
  requested: boolean;
  prNumber: number;
  reviewers: string[];
}

export interface ReplyReviewCommentRequest {
  repoOrId: string;
  prNumber: number;
  commentId: number;
  body: string;
}

export interface ReplyReviewCommentResponse {
  ok: true;
  replied: boolean;
  prNumber: number;
  commentId: number;
}
