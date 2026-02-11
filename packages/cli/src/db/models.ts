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
  next_commit_check_at: number;
  next_pr_check_at: number;
  idle_streak: number;
  last_pr_checked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TriggerStateRow {
  repo_id: string;
  trigger_id: 'commit' | 'pr' | 'manual';
  state_json: string;
  next_check_at: number | null;
  last_checked_at: number | null;
  updated_at: number;
}

export interface TriggerEventRow {
  id: string;
  repo_id: string;
  trigger_id: 'commit' | 'pr' | 'manual';
  event_key: string;
  subject: string;
  payload_json: string;
  source: 'fswatch' | 'poll' | 'tool-hook' | 'cli' | 'recovery';
  detected_at: number;
}

export interface ReviewRunRow {
  id: string;
  repo_id: string;
  trigger_event_id: string;
  agent: string;
  scope: string;
  scope_input_json: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  priority: number;
  attempt: number;
  max_attempts: number;
  next_attempt_at: number;
  queued_at: number;
  started_at: number | null;
  finished_at: number | null;
  model_id: string | null;
  variant: string | null;
  session_id: string | null;
  outcome: AgentRunOutcome | null;
  summary_json: string | null;
  findings_count: number;
  raw_output: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface EventRow {
  seq: number;
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  event_type: string;
  repo_id: string | null;
  job_id: string | null;
  agent_run_id: string | null;
  trigger_event_id: string | null;
  review_run_id: string | null;
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
  next_attempt_at: number;
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
  job_id: string | null;
  agent_run_id: string | null;
  review_run_id?: string | null;
  agent: string;
  severity: string;
  domain: string;
  location: string;
  evidence: string;
  prescription: string;
  fingerprint: string;
  created_at: number;
}
