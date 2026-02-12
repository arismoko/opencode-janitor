import type {
  DashboardAgentStateRow,
  DashboardReportFindingRow,
  DashboardReportSummaryRow,
  DashboardRepoStateRow,
} from '../db/queries/dashboard-queries';

type ParsedEnrichment = {
  kind: string;
  version: number;
  payload: Record<string, unknown>;
  collapsed?: boolean;
};

function parseEnrichmentsFromDetailsJson(
  detailsJson: string | null | undefined,
): ParsedEnrichment[] | undefined {
  if (!detailsJson) return undefined;
  try {
    const parsed = JSON.parse(detailsJson) as {
      enrichments?: unknown;
    };

    if (!Array.isArray(parsed?.enrichments)) {
      return undefined;
    }

    const enrichments: ParsedEnrichment[] = [];
    for (const section of parsed.enrichments) {
      if (!section || typeof section !== 'object') continue;
      const value = section as Record<string, unknown>;
      if (typeof value.kind !== 'string' || value.kind.length === 0) continue;
      if (
        typeof value.version !== 'number' ||
        !Number.isFinite(value.version)
      ) {
        continue;
      }
      if (!value.payload || typeof value.payload !== 'object') continue;
      const collapsed =
        typeof value.collapsed === 'boolean' ? value.collapsed : undefined;
      enrichments.push({
        kind: value.kind,
        version: value.version,
        payload: value.payload as Record<string, unknown>,
        collapsed,
      });
    }

    return enrichments.length > 0 ? enrichments : undefined;
  } catch {
    return undefined;
  }
}

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
  const enrichments = parseEnrichmentsFromDetailsJson(finding.details_json);
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
    enrichments,
    createdAt: finding.created_at,
  };
}
