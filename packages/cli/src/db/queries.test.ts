import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { AGENT_IDS } from '@opencode-janitor/shared';
import { ensureSchema } from './migrations';
import {
  getDashboardReportDetail,
  listDashboardReportFindings,
  listDashboardReportSummaries,
} from './queries/dashboard-queries';
import {
  appendEvent,
  listEventsAfterSeqFiltered,
} from './queries/event-queries';
import {
  addRepo,
  findRepoByIdOrPath,
  listRepos,
  removeRepoByIdOrPath,
} from './queries/repo-queries';
import {
  claimNextQueuedReviewRun,
  deleteReviewRun,
  enqueueReviewRun,
  findReviewRunContextBySessionId,
  getReviewRunById,
  markReviewRunCancelled,
  markReviewRunFailed,
  markReviewRunRunning,
  markReviewRunSucceeded,
  recoverRunningReviewRuns,
  replaceReviewRunFindings,
  requeueReviewRun,
  resumeReviewRunInPlace,
} from './queries/review-run-queries';
import {
  getTriggerEventById,
  insertTriggerEvent,
  listTriggerEventsWithoutRuns,
} from './queries/trigger-event-queries';
import {
  getTriggerState,
  listTriggerStatesDue,
  upsertTriggerState,
} from './queries/trigger-state-queries';

const firstAgent = AGENT_IDS[0];
const secondAgent = AGENT_IDS[1] ?? AGENT_IDS[0];
const thirdAgent = AGENT_IDS[2] ?? AGENT_IDS[0];
const fourthAgent = AGENT_IDS[3] ?? AGENT_IDS[0];

function createDb(): Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
}

function seedRepo(db: Database) {
  return addRepo(db, {
    path: '/tmp/repo-a',
    gitDir: '/tmp/repo-a/.git',
    defaultBranch: 'main',
  });
}

function seedTriggerEvent(db: Database, repoId: string) {
  return insertTriggerEvent(db, {
    repoId,
    triggerId: 'commit',
    eventKey: 'sha-1',
    subject: 'commit:sha-1',
    payloadJson: JSON.stringify({ sha: 'sha-1' }),
    source: 'poll',
    detectedAt: Date.now(),
  });
}

describe('repo queries', () => {
  it('adds, finds, lists, and removes repos', () => {
    const db = createDb();
    const repo = seedRepo(db);

    expect(findRepoByIdOrPath(db, repo.id)?.path).toBe('/tmp/repo-a');
    expect(findRepoByIdOrPath(db, '/tmp/repo-a')?.id).toBe(repo.id);
    expect(listRepos(db)).toHaveLength(1);

    const removed = removeRepoByIdOrPath(db, repo.id);
    expect(removed?.id).toBe(repo.id);
    expect(listRepos(db)).toHaveLength(0);
  });
});

describe('trigger state queries', () => {
  it('upserts and lists due states', () => {
    const db = createDb();
    const repo = seedRepo(db);

    upsertTriggerState(db, {
      repoId: repo.id,
      triggerId: 'commit',
      stateJson: JSON.stringify({ lastHeadSha: 'abc' }),
      nextCheckAt: 100,
      lastCheckedAt: 50,
    });

    const row = getTriggerState(db, repo.id, 'commit');
    expect(row?.state_json).toContain('lastHeadSha');

    const due = listTriggerStatesDue(db, 'commit', 200, 10);
    expect(due).toHaveLength(1);
    expect(due[0]!.repo_id).toBe(repo.id);
  });
});

describe('trigger event queries', () => {
  it('dedupes by repo/trigger/event_key', () => {
    const db = createDb();
    const repo = seedRepo(db);

    const first = seedTriggerEvent(db, repo.id);
    const second = seedTriggerEvent(db, repo.id);

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.eventId).toBe(first.eventId);
    expect(getTriggerEventById(db, first.eventId)?.subject).toBe(
      'commit:sha-1',
    );
  });

  it('lists events without planned runs', () => {
    const db = createDb();
    const repo = seedRepo(db);
    const event = seedTriggerEvent(db, repo.id);

    const rows = listTriggerEventsWithoutRuns(db, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(event.eventId);
  });
});

describe('review run queries', () => {
  it('enqueues, claims, runs, and marks success', () => {
    const db = createDb();
    const repo = seedRepo(db);
    const event = seedTriggerEvent(db, repo.id);

    const enqueue = enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: event.eventId,
      agent: firstAgent,
      scope: 'commit-diff',
    });
    expect(enqueue.inserted).toBe(true);

    const claimed = claimNextQueuedReviewRun(db, 1);
    expect(claimed?.id).toBe(enqueue.runId);

    markReviewRunRunning(db, enqueue.runId, 'sess-1');
    replaceReviewRunFindings(db, enqueue.runId, [
      {
        repo_id: repo.id,
        agent: firstAgent,
        severity: 'P1',
        domain: 'DRY',
        location: 'src/a.ts:1',
        evidence: 'duplicate branch',
        prescription: 'extract helper',
        details_json: '{}',
        fingerprint: 'dry:src/a.ts:1:P1',
      },
    ]);

    markReviewRunSucceeded(
      db,
      enqueue.runId,
      1,
      '{"findings":[{}]}',
      'succeeded',
      JSON.stringify({ outcome: 'succeeded' }),
    );

    const detail = getDashboardReportDetail(db, enqueue.runId);
    expect(detail?.status).toBe('succeeded');
    expect(detail?.findings_count).toBe(1);

    const findings = listDashboardReportFindings(db, enqueue.runId, 10);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.review_run_id).toBe(enqueue.runId);
    expect(findings[0]!.details_json).toBe('{}');
  });

  it('persists and returns findings.details_json payload', () => {
    const db = createDb();
    const repo = seedRepo(db);
    const event = seedTriggerEvent(db, repo.id);

    const enqueue = enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: event.eventId,
      agent: thirdAgent,
      scope: 'repo',
    });

    claimNextQueuedReviewRun(db, 1);
    markReviewRunRunning(db, enqueue.runId, 'sess-arch');
    replaceReviewRunFindings(db, enqueue.runId, [
      {
        repo_id: repo.id,
        agent: thirdAgent,
        severity: 'P1',
        domain: 'DESIGN',
        location: 'src/core.ts:10',
        evidence: 'Layer boundary leak',
        prescription: 'Introduce a port boundary',
        details_json: JSON.stringify({
          enrichments: [
            {
              kind: 'architecture',
              version: 1,
              payload: {
                principles: ['DEPENDENCY_INVERSION'],
                antiPattern: {
                  label: 'LAYERING_VIOLATION',
                  detail: 'Domain layer reaches infrastructure directly',
                },
                recommendedPattern: {
                  label: 'HEXAGONAL_PORTS_ADAPTERS',
                  detail:
                    'Route dependencies through explicit ports to isolate adapters.',
                },
                rewritePlan: ['Define port', 'Move implementation to adapter'],
                tradeoffs: ['More interfaces'],
                impactScope: 'SUBSYSTEM',
              },
            },
          ],
        }),
        fingerprint: 'design:src/core.ts:10:P1',
      },
    ]);

    const findings = listDashboardReportFindings(db, enqueue.runId, 10);
    expect(findings).toHaveLength(1);
    const parsed = JSON.parse(findings[0]!.details_json) as {
      enrichments?: Array<{
        kind?: string;
        payload?: { impactScope?: string };
      }>;
    };
    expect(parsed.enrichments?.[0]?.kind).toBe('architecture');
    expect(parsed.enrichments?.[0]?.payload?.impactScope).toBe('SUBSYSTEM');
  });

  it('requeues and recovers running runs', () => {
    const db = createDb();
    const repo = seedRepo(db);
    const event = seedTriggerEvent(db, repo.id);
    const { runId } = enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: event.eventId,
      agent: secondAgent,
      scope: 'pr',
      scopeInputJson: JSON.stringify({ prNumber: 42 }),
    });

    claimNextQueuedReviewRun(db, 1);
    markReviewRunRunning(db, runId, 'sess-2');
    requeueReviewRun(db, runId, Date.now() + 5000, 'ERR', 'retry later');

    const claimedAgain = claimNextQueuedReviewRun(db, 1);
    expect(claimedAgain).toBeNull();

    const resetCount = recoverRunningReviewRuns(db);
    expect(resetCount).toBe(0);
  });

  it('finds session context and deletes finished runs', () => {
    const db = createDb();
    const repo = seedRepo(db);
    const event = seedTriggerEvent(db, repo.id);
    const { runId } = enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: event.eventId,
      agent: fourthAgent,
      scope: 'repo',
    });

    claimNextQueuedReviewRun(db, 1);
    markReviewRunRunning(db, runId, 'sess-ctx');
    const ctx = findReviewRunContextBySessionId(db, 'sess-ctx');
    expect(ctx?.reviewRunId).toBe(runId);
    expect(ctx?.repoId).toBe(repo.id);

    expect(deleteReviewRun(db, runId)).toBe(false);

    markReviewRunFailed(
      db,
      runId,
      'AGENT_ERROR',
      'boom',
      'failed_terminal',
      JSON.stringify({ outcome: 'failed_terminal' }),
    );
    expect(deleteReviewRun(db, runId)).toBe(true);
  });

  it('marks queued run as cancelled and persists cancellation outcome', () => {
    const db = createDb();
    const repo = seedRepo(db);
    const event = seedTriggerEvent(db, repo.id);
    const { runId } = enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: event.eventId,
      agent: fourthAgent,
      scope: 'repo',
    });

    markReviewRunCancelled(db, runId, 'REVIEW_STOPPED', 'stopped by user');

    const row = getDashboardReportDetail(db, runId);
    expect(row?.status).toBe('cancelled');
    expect(row?.outcome).toBe('cancelled');
    expect(row?.error_message).toBe('stopped by user');
  });

  it('resumes cancelled run in-place while preserving session_id', () => {
    const db = createDb();
    const repo = seedRepo(db);
    const event = seedTriggerEvent(db, repo.id);
    const { runId } = enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: event.eventId,
      agent: secondAgent,
      scope: 'pr',
    });

    claimNextQueuedReviewRun(db, 1);
    markReviewRunRunning(db, runId, 'sess-resume-1');
    markReviewRunCancelled(db, runId, 'AGENT_CANCELLED', 'cancelled');
    replaceReviewRunFindings(db, runId, [
      {
        repo_id: repo.id,
        agent: secondAgent,
        severity: 'P1',
        domain: 'BUG',
        location: 'src/x.ts:1',
        evidence: 'x',
        prescription: 'y',
        details_json: '{}',
        fingerprint: 'fp-resume',
      },
    ]);

    const resumed = resumeReviewRunInPlace(db, runId);
    expect(resumed).toBe(true);

    const run = getReviewRunById(db, runId);
    expect(run?.status).toBe('queued');
    expect(run?.session_id).toBe('sess-resume-1');
    expect(run?.outcome).toBeNull();
    expect(run?.error_code).toBeNull();
    expect(run?.error_message).toBeNull();
    expect(run?.raw_output).toBeNull();
    expect(run?.findings_count).toBe(0);

    const findingCount = db
      .query('SELECT COUNT(*) AS count FROM findings WHERE review_run_id = ?')
      .get(runId) as { count: number };
    expect(findingCount.count).toBe(0);
  });

  it('resume in-place is a no-op for non-cancelled run', () => {
    const db = createDb();
    const repo = seedRepo(db);
    const event = seedTriggerEvent(db, repo.id);
    const { runId } = enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: event.eventId,
      agent: firstAgent,
      scope: 'commit-diff',
    });

    const resumed = resumeReviewRunInPlace(db, runId);
    expect(resumed).toBe(false);
  });
});

describe('event queries', () => {
  it('filters by review run and session id', () => {
    const db = createDb();
    const repo = seedRepo(db);
    const event = seedTriggerEvent(db, repo.id);
    const { runId } = enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: event.eventId,
      agent: firstAgent,
      scope: 'commit-diff',
    });

    claimNextQueuedReviewRun(db, 1);
    markReviewRunRunning(db, runId, 'sess-events');

    appendEvent(db, {
      eventType: 'session.delta',
      repoId: repo.id,
      triggerEventId: event.eventId,
      reviewRunId: runId,
      message: 'chunk',
      payload: { sessionId: 'sess-events', delta: 'hi' },
    });

    const filtered = listEventsAfterSeqFiltered(db, 0, 20, {
      reviewRunId: runId,
      sessionId: 'sess-events',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.review_run_id).toBe(runId);
    expect(filtered[0]!.session_id).toBe('sess-events');
  });
});

describe('dashboard queries', () => {
  it('returns report summaries ordered by latest run time', () => {
    const db = createDb();
    const repo = seedRepo(db);
    const event = seedTriggerEvent(db, repo.id);

    const a = enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: event.eventId,
      agent: firstAgent,
      scope: 'commit-diff',
    });
    claimNextQueuedReviewRun(db, 1);
    markReviewRunSucceeded(
      db,
      a.runId,
      0,
      '{}',
      'succeeded',
      JSON.stringify({ outcome: 'succeeded' }),
    );

    const rows = listDashboardReportSummaries(db, 10);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.trigger_event_id).toBe(event.eventId);
  });
});
