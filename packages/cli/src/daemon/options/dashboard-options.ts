import {
  getDashboardReportDetail,
  listDashboardAgentState,
  listDashboardReportFindings,
  listDashboardReportSummaries,
  listDashboardRepoState,
} from '../../db/queries/dashboard-queries';
import {
  appendEvent,
  getLatestEventSeq,
  listEvents,
} from '../../db/queries/event-queries';
import { deleteAgentRun } from '../../db/queries/scheduler-queries';
import { toEventEntry } from '../../ipc/event-entry';
import type { RuntimeContext } from '../../runtime/context';
import {
  mapDashboardAgentRow,
  mapDashboardFindingRow,
  mapDashboardRepoRow,
  mapDashboardReportSummaryRow,
} from '../dashboard-mappers';
import type { DaemonStatusSnapshot, DashboardApi } from '../socket-types';

export function createDashboardOptions(
  rc: RuntimeContext,
  statusSnapshot: () => DaemonStatusSnapshot,
): DashboardApi {
  return {
    getDashboardSnapshot: (eventsLimit, reportsLimit) => {
      const eventsDesc = listEvents(rc.db, eventsLimit);
      const eventRows = eventsDesc.reverse();
      const latestSeq = eventRows.at(-1)?.seq ?? getLatestEventSeq(rc.db);
      const events = eventRows.map((row) => toEventEntry(row));

      const repos = listDashboardRepoState(rc.db).map(mapDashboardRepoRow);
      const agents = listDashboardAgentState(rc.db).map(mapDashboardAgentRow);
      const reports = listDashboardReportSummaries(rc.db, reportsLimit).map(
        mapDashboardReportSummaryRow,
      );

      const snap = statusSnapshot();
      return {
        ok: true as const,
        generatedAt: Date.now(),
        latestSeq,
        daemon: {
          pid: snap.pid,
          uptimeMs: snap.uptimeMs,
          draining: snap.draining,
          socketPath: snap.socketPath,
          dbPath: snap.dbPath,
        },
        repos,
        agents,
        reports,
        events,
      };
    },
    getDashboardReportDetail: (agentRunId, findingsLimit) => {
      const row = getDashboardReportDetail(rc.db, agentRunId);
      if (!row) {
        return null;
      }

      const findings = listDashboardReportFindings(
        rc.db,
        agentRunId,
        findingsLimit,
      ).map(mapDashboardFindingRow);

      return {
        ok: true as const,
        generatedAt: Date.now(),
        report: mapDashboardReportSummaryRow(row),
        findings,
        rawOutput: row.raw_output,
      };
    },
    onDeleteReport: (agentRunId) => {
      const deleted = deleteAgentRun(rc.db, agentRunId);
      if (deleted) {
        appendEvent(rc.db, {
          eventType: 'report.deleted',
          message: `Report ${agentRunId} deleted`,
          level: 'info',
        });
      }
      return {
        ok: true as const,
        deleted,
        agentRunId,
      };
    },
  };
}
