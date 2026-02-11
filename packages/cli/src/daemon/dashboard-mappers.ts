import type {
  DashboardAgentStateRow,
  DashboardReportFindingRow,
  DashboardReportSummaryRow,
  DashboardRepoStateRow,
} from '../db/queries/dashboard-queries';

export function mapDashboardRepoRow(row: DashboardRepoStateRow) {
  return {
    id: row.id,
    path: row.path,
    enabled: row.enabled === 1,
    paused: row.paused === 1,
    defaultBranch: row.default_branch,
    queuedJobs: row.queued_jobs,
    runningJobs: row.running_jobs,
    latestEventTs: row.latest_event_ts,
  };
}

export function mapDashboardAgentRow(row: DashboardAgentStateRow) {
  return {
    agent: row.agent,
    queuedRuns: row.queued_runs,
    runningRuns: row.running_runs,
    succeededRuns: row.succeeded_runs,
    failedRuns: row.failed_runs,
    lastFinishedAt: row.last_finished_at,
  };
}

export function mapDashboardReportSummaryRow(row: DashboardReportSummaryRow) {
  return {
    id: row.id,
    repoId: row.repo_id,
    repoPath: row.repo_path,
    triggerEventId: row.trigger_event_id,
    subject: row.subject,
    agent: row.agent,
    sessionId: row.session_id,
    status: row.status,
    outcome: row.outcome,
    findingsCount: row.findings_count,
    p0Count: row.p0_count,
    p1Count: row.p1_count,
    p2Count: row.p2_count,
    p3Count: row.p3_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  };
}

export function mapDashboardFindingRow(finding: DashboardReportFindingRow) {
  return {
    id: finding.id,
    repoId: finding.repo_id,
    repoPath: finding.repo_path,
    triggerEventId: finding.trigger_event_id,
    reviewRunId: finding.review_run_id,
    agent: finding.agent,
    severity: finding.severity,
    domain: finding.domain,
    location: finding.location,
    evidence: finding.evidence,
    prescription: finding.prescription,
    createdAt: finding.created_at,
  };
}
