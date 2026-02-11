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
  /** Agent name to run (janitor/hunter/inspector/scribe). */
  agent: AgentName;
  /** Optional manual scope request (commit-diff/workspace-diff/repo/pr). */
  scope?: ScopeId;
  /** Optional scope-specific input object validated against scope schema. */
  input?: Record<string, unknown>;
  /** Optional freeform note carried in manual trigger payload metadata. */
  note?: string;
}

export interface DeleteReportRequest {
  agentRunId: string;
}

export interface DeleteReportResponse {
  ok: true;
  deleted: boolean;
  agentRunId: string;
}

export interface EnqueueReviewResponse {
  ok: true;
  enqueued: boolean;
  repoId: string;
  repoPath: string;
  sha: string;
  subjectKey: string;
}

export interface EventJournalEntry {
  eventId: number;
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  topic: string;
  repoId: string | null;
  jobId: string | null;
  agentRunId: string | null;
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
  idleStreak: number;
  nextCommitCheckAt: number;
  nextPrCheckAt: number;
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
  jobId: string;
  subjectKey: string | null;
  agent: AgentName;
  sessionId: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
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
  jobId: string;
  agentRunId: string;
  agent: AgentName;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  domain: string;
  location: string;
  evidence: string;
  prescription: string;
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
