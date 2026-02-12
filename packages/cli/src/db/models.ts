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
  outcome: ReviewRunOutcome | null;
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
  trigger_event_id: string | null;
  review_run_id: string | null;
  message: string;
  payload_json: string;
}

export type ReviewRunOutcome =
  | 'succeeded'
  | 'failed_transient'
  | 'failed_terminal'
  | 'cancelled';

export interface FindingRow {
  id: string;
  repo_id: string;
  review_run_id: string;
  agent: string;
  severity: string;
  domain: string;
  location: string;
  evidence: string;
  prescription: string;
  details_json: string;
  fingerprint: string;
  created_at: number;
}
