/**
 * TypeScript interfaces for database rows used by CLI commands.
 */

export interface RepoRow {
  id: string;
  path: string;
  git_dir: string;
  default_branch: string;
  enabled: 0 | 1;
  paused: 0 | 1;
  last_head_sha: string | null;
  last_pr_key: string | null;
  created_at: number;
  updated_at: number;
}

export interface EventRow {
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

/**
 * Joined row returned by `claimNextQueuedJob`.
 * Contains job fields plus repo and trigger context.
 */
export interface QueuedJobRow {
  id: string;
  repo_id: string;
  trigger_id: string | null;
  dedupe_key: string;
  attempt: number;
  max_attempts: number;
  queued_at: number;

  // repo fields
  path: string;
  default_branch: string;

  // trigger fields
  kind: 'commit' | 'pr' | 'manual';
  subject_key: string;
  payload_json: string;
}

export type AgentRunOutcome =
  | 'succeeded'
  | 'failed_transient'
  | 'failed_terminal'
  | 'cancelled';

export interface AgentRunSummary {
  outcome: AgentRunOutcome;
  retryable: boolean;
  findingsCount: number;
  durationMs: number;
  sessionId: string | null;
  completion: 'idle' | 'timeout' | 'error' | 'cancelled' | 'unknown';
  errorCode?: string;
  errorMessage?: string;
}

export interface AgentRunRow {
  id: string;
  job_id: string;
  agent: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  model_id: string | null;
  variant: string | null;
  session_id: string | null;
  outcome: AgentRunOutcome | null;
  summary_json: string | null;
  findings_count: number;
  raw_output: string | null;
  started_at: number | null;
  finished_at: number | null;
  error_code: string | null;
  error_message: string | null;
}

export interface FindingRow {
  id: string;
  repo_id: string;
  job_id: string;
  agent_run_id: string;
  agent: string;
  severity: string;
  domain: string;
  location: string;
  evidence: string;
  prescription: string;
  fingerprint: string;
  created_at: number;
}
