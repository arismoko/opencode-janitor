import type { Database } from 'bun:sqlite';
import type { AgentName } from '@opencode-janitor/shared';

export interface DashboardRepoStateRow {
  id: string;
  path: string;
  enabled: 0 | 1;
  paused: 0 | 1;
  default_branch: string;
  queued_jobs: number;
  running_jobs: number;
  latest_event_ts: number | null;
}

export interface DashboardAgentStateRow {
  agent: AgentName;
  queued_runs: number;
  running_runs: number;
  succeeded_runs: number;
  failed_runs: number;
  last_finished_at: number | null;
}

export interface DashboardReportSummaryRow {
  id: string;
  repo_id: string;
  repo_path: string;
  trigger_event_id: string;
  subject: string | null;
  agent: AgentName;
  session_id: string | null;
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
  findings_count: number;
  p0_count: number;
  p1_count: number;
  p2_count: number;
  p3_count: number;
  started_at: number | null;
  finished_at: number | null;
  error_message: string | null;
}

export interface DashboardReportDetailRow extends DashboardReportSummaryRow {
  raw_output: string | null;
}

export interface DashboardReportFindingRow {
  id: string;
  repo_id: string;
  repo_path: string;
  trigger_event_id: string;
  review_run_id: string;
  agent: AgentName;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  domain: string;
  location: string;
  evidence: string;
  prescription: string;
  details_json: string;
  created_at: number;
}

export function listDashboardRepoState(db: Database): DashboardRepoStateRow[] {
  return db
    .query(
      `
      SELECT
        r.id,
        r.path,
        r.enabled,
        r.paused,
        r.default_branch,
        COALESCE(jc.queued_jobs, 0)  AS queued_jobs,
        COALESCE(jc.running_jobs, 0) AS running_jobs,
        ev.latest_event_ts
      FROM repos r
      LEFT JOIN (
        SELECT
          repo_id,
          SUM(CASE WHEN status = 'queued'  THEN 1 ELSE 0 END) AS queued_jobs,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_jobs
        FROM review_runs
        GROUP BY repo_id
      ) jc ON jc.repo_id = r.id
      LEFT JOIN (
        SELECT repo_id, MAX(ts) AS latest_event_ts
        FROM event_journal
        WHERE repo_id IS NOT NULL
        GROUP BY repo_id
      ) ev ON ev.repo_id = r.id
      ORDER BY r.path ASC
      `,
    )
    .all() as DashboardRepoStateRow[];
}

export function listDashboardAgentState(
  db: Database,
): DashboardAgentStateRow[] {
  return db
    .query(
      `
      SELECT
        agent,
        SUM(CASE WHEN status = 'queued'    THEN 1 ELSE 0 END) AS queued_runs,
        SUM(CASE WHEN status = 'running'   THEN 1 ELSE 0 END) AS running_runs,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded_runs,
        SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed_runs,
        MAX(CASE WHEN finished_at IS NOT NULL THEN finished_at ELSE NULL END) AS last_finished_at
      FROM review_runs
      GROUP BY agent
      ORDER BY agent ASC
      `,
    )
    .all() as DashboardAgentStateRow[];
}

const REPORT_SUMMARY_BASE_SELECT = `
  SELECT
    rr.id,
    rr.repo_id,
    r.path AS repo_path,
    rr.trigger_event_id,
    te.subject,
    rr.agent,
    rr.session_id,
    rr.status,
    rr.outcome,
    rr.findings_count,
    COALESCE(fs.p0_count, 0) AS p0_count,
    COALESCE(fs.p1_count, 0) AS p1_count,
    COALESCE(fs.p2_count, 0) AS p2_count,
    COALESCE(fs.p3_count, 0) AS p3_count,
    rr.started_at,
    rr.finished_at,
    rr.error_message
  FROM review_runs rr
  JOIN repos r ON r.id = rr.repo_id
  LEFT JOIN trigger_events te ON te.id = rr.trigger_event_id
  LEFT JOIN (
    SELECT
      review_run_id,
      SUM(CASE WHEN severity = 'P0' THEN 1 ELSE 0 END) AS p0_count,
      SUM(CASE WHEN severity = 'P1' THEN 1 ELSE 0 END) AS p1_count,
      SUM(CASE WHEN severity = 'P2' THEN 1 ELSE 0 END) AS p2_count,
      SUM(CASE WHEN severity = 'P3' THEN 1 ELSE 0 END) AS p3_count
    FROM findings
    WHERE review_run_id IS NOT NULL
    GROUP BY review_run_id
  ) fs ON fs.review_run_id = rr.id
`;

export function listDashboardReportSummaries(
  db: Database,
  limit: number,
): DashboardReportSummaryRow[] {
  return db
    .query(
      `
      ${REPORT_SUMMARY_BASE_SELECT}
      ORDER BY COALESCE(rr.finished_at, rr.started_at, rr.queued_at) DESC, rr.id DESC
      LIMIT ?
      `,
    )
    .all(limit) as DashboardReportSummaryRow[];
}

export function getDashboardReportDetail(
  db: Database,
  reviewRunId: string,
): DashboardReportDetailRow | null {
  return (
    (db
      .query(
        `
      ${REPORT_SUMMARY_BASE_SELECT.replace('rr.error_message', 'rr.error_message,\n    rr.raw_output')}
      WHERE rr.id = ?
      LIMIT 1
      `,
      )
      .get(reviewRunId) as DashboardReportDetailRow | null) ?? null
  );
}

export function listDashboardReportFindings(
  db: Database,
  reviewRunId: string,
  limit: number,
): DashboardReportFindingRow[] {
  return db
    .query(
      `
      SELECT
        f.id,
        f.repo_id,
        r.path AS repo_path,
        rr.trigger_event_id,
        f.review_run_id,
        f.agent,
        f.severity,
        f.domain,
        f.location,
        f.evidence,
        f.prescription,
        f.details_json,
        f.created_at
      FROM findings f
      JOIN review_runs rr ON rr.id = f.review_run_id
      JOIN repos r ON r.id = f.repo_id
      WHERE f.review_run_id = ?
      ORDER BY
        CASE f.severity
          WHEN 'P0' THEN 0
          WHEN 'P1' THEN 1
          WHEN 'P2' THEN 2
          ELSE 3
        END ASC,
        f.created_at DESC
      LIMIT ?
      `,
    )
    .all(reviewRunId, limit) as DashboardReportFindingRow[];
}
