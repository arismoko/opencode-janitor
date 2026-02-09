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
}

export interface StopResponse {
  ok: true;
  draining: true;
}

export interface EnqueueReviewRequest {
  repoOrId: string;
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
  seq: number;
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  event_type: string;
  repo_id: string | null;
  job_id: string | null;
  agent_run_id: string | null;
  message: string;
  payload_json: string;
}

export interface EventsResponse {
  ok: true;
  afterSeq: number;
  events: EventJournalEntry[];
}
