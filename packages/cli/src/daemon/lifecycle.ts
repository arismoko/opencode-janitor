import { resolve as resolvePath } from 'node:path';
import { manualKey } from '@opencode-janitor/shared';
import {
  appendEvent,
  deleteAgentRun,
  enqueueTriggerAndJob,
  findRepoByIdOrPath,
  getDashboardReportDetail,
  getLatestEventSeq,
  listDashboardAgentState,
  listDashboardReportFindings,
  listDashboardReportSummaries,
  listDashboardRepoState,
  listEvents,
  listEventsAfterSeq,
  listEventsAfterSeqFiltered,
} from '../db/queries';
import { toEventEntry } from '../ipc/event-entry';
import {
  type BootstrapRuntimeOptions,
  bootstrapRuntime,
  shutdownRuntime,
} from '../runtime/bootstrap';
import type { SocketContext } from '../runtime/context';
import { resolveHeadSha } from '../utils/git';
import {
  createSocketServer,
  type DaemonStatusSnapshot,
  type SocketServerOptions,
} from './socket';
import { createWebServer } from './web';

export interface RunDaemonOptions extends BootstrapRuntimeOptions {}

const SCHEDULER_DRAIN_TIMEOUT_MS = 10_000;
const SHUTDOWN_CANCEL_MESSAGE = 'daemon stopping';

function buildStatusSnapshot(
  rc: SocketContext,
  draining: boolean,
): DaemonStatusSnapshot {
  return {
    pid: process.pid,
    version: '0.1.0',
    uptimeMs: Date.now() - rc.startedAt,
    draining,
    socketPath: rc.config.daemon.socketPath,
    dbPath: rc.dbPath,
    webHost: rc.config.daemon.webHost,
    webPort: rc.config.daemon.webPort,
  };
}

export async function runDaemon(options: RunDaemonOptions): Promise<void> {
  const { rc, recoveredJobs, recoveredAgentRuns } =
    await bootstrapRuntime(options);

  let draining = false;
  let resolved = false;
  let resolveStop: (() => void) | null = null;
  const statusSnapshot = (): DaemonStatusSnapshot =>
    buildStatusSnapshot(rc, draining);

  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  let server: ReturnType<typeof createSocketServer> | null = null;
  let webServer: ReturnType<typeof createWebServer> | null = null;
  try {
    const socketOptions: SocketServerOptions = {
      socketPath: rc.config.daemon.socketPath,
      getStatus: statusSnapshot,
      onStopRequested: () => {
        shutdown();
      },
      onEnqueueReview: async ({ repoOrId, agent }) => {
        const normalized = resolvePath(repoOrId);
        const repo =
          findRepoByIdOrPath(rc.db, normalized) ??
          findRepoByIdOrPath(rc.db, repoOrId);

        if (!repo) {
          throw new Error(
            `Repository not found: ${repoOrId}. Use \`janitor add\` first.`,
          );
        }

        const sha = resolveHeadSha(repo.path);
        const subjectKey = manualKey(String(Date.now()), sha);
        const enqueued = enqueueTriggerAndJob(rc.db, {
          repoId: repo.id,
          kind: 'manual',
          source: 'cli',
          subjectKey,
          payload: { sha, manual: true, ...(agent ? { agent } : {}) },
          maxAttempts: rc.config.scheduler.maxAttempts,
        });

        if (enqueued) {
          rc.scheduler.wake();
          appendEvent(rc.db, {
            eventType: 'review.enqueued',
            repoId: repo.id,
            message: agent
              ? `Manual ${agent} review enqueued for ${sha.slice(0, 10)}`
              : `Manual review enqueued for ${sha.slice(0, 10)}`,
            level: 'info',
            payload: { sha, subjectKey, ...(agent ? { agent } : {}) },
          });
        }

        return {
          ok: true as const,
          enqueued,
          repoId: repo.id,
          repoPath: repo.path,
          sha,
          subjectKey,
        };
      },
      listEventsAfterSeq: (afterSeq, limit) =>
        listEventsAfterSeq(rc.db, afterSeq, limit),
      listEventsAfterSeqFiltered: (afterSeq, limit, filters) =>
        listEventsAfterSeqFiltered(rc.db, afterSeq, limit, filters),
      getDashboardSnapshot: (eventsLimit, reportsLimit) => {
        const eventsDesc = listEvents(rc.db, eventsLimit);
        const eventRows = eventsDesc.reverse();
        const latestSeq = eventRows.at(-1)?.seq ?? getLatestEventSeq(rc.db);
        const events = eventRows.map((row) => toEventEntry(row));

        const repoRows = listDashboardRepoState(rc.db);
        const repos = repoRows.map((r) => ({
          id: r.id,
          path: r.path,
          enabled: r.enabled === 1,
          paused: r.paused === 1,
          defaultBranch: r.default_branch,
          idleStreak: r.idle_streak,
          nextCommitCheckAt: r.next_commit_check_at,
          nextPrCheckAt: r.next_pr_check_at,
          queuedJobs: r.queued_jobs,
          runningJobs: r.running_jobs,
          latestEventTs: r.latest_event_ts,
        }));

        const agentRows = listDashboardAgentState(rc.db);
        const agents = agentRows.map((a) => ({
          agent: a.agent,
          queuedRuns: a.queued_runs,
          runningRuns: a.running_runs,
          succeededRuns: a.succeeded_runs,
          failedRuns: a.failed_runs,
          lastFinishedAt: a.last_finished_at,
        }));

        const reportRows = listDashboardReportSummaries(rc.db, reportsLimit);
        const reports = reportRows.map((row) => ({
          id: row.id,
          repoId: row.repo_id,
          repoPath: row.repo_path,
          jobId: row.job_id,
          subjectKey: row.subject_key,
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
        }));

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
        ).map((finding) => ({
          id: finding.id,
          repoId: finding.repo_id,
          repoPath: finding.repo_path,
          jobId: finding.job_id,
          agentRunId: finding.agent_run_id,
          agent: finding.agent,
          severity: finding.severity,
          domain: finding.domain,
          location: finding.location,
          evidence: finding.evidence,
          prescription: finding.prescription,
          createdAt: finding.created_at,
        }));

        return {
          ok: true as const,
          generatedAt: Date.now(),
          report: {
            id: row.id,
            repoId: row.repo_id,
            repoPath: row.repo_path,
            jobId: row.job_id,
            subjectKey: row.subject_key,
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
          },
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

    server = createSocketServer(socketOptions);
    webServer = createWebServer({
      hostname: rc.config.daemon.webHost,
      port: rc.config.daemon.webPort,
      apiOptions: socketOptions,
    });
  } catch (error) {
    server?.stop(true);
    webServer?.stop(true);
    await shutdownRuntime(rc, {
      schedulerDrainTimeoutMs: SCHEDULER_DRAIN_TIMEOUT_MS,
      cancelMessage: SHUTDOWN_CANCEL_MESSAGE,
    });
    throw error;
  }

  const onSignal = () => shutdown();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    appendEvent(rc.db, {
      eventType: 'daemon.started',
      message: 'Daemon started',
      level: 'info',
      payload:
        recoveredJobs > 0 || recoveredAgentRuns > 0
          ? {
              recoveredJobs,
              recoveredAgentRuns,
              webUrl: `http://${rc.config.daemon.webHost}:${rc.config.daemon.webPort}`,
            }
          : {
              webUrl: `http://${rc.config.daemon.webHost}:${rc.config.daemon.webPort}`,
            },
    });
  } catch {
    // Ignore startup event logging failures.
  }

  await stopPromise;

  function shutdown(): void {
    if (resolved) {
      return;
    }

    resolved = true;
    draining = true;

    try {
      appendEvent(rc.db, {
        eventType: 'daemon.stopping',
        message: 'Daemon stop requested',
        level: 'info',
      });
    } catch {
      // Ignore shutdown event logging failures.
    }

    server?.stop(true);
    webServer?.stop(true);
    resolveStop?.();
  }

  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  await shutdownRuntime(rc, {
    schedulerDrainTimeoutMs: SCHEDULER_DRAIN_TIMEOUT_MS,
    cancelMessage: SHUTDOWN_CANCEL_MESSAGE,
  });
}
