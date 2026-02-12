import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
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
  markReviewRunFailed,
  markReviewRunRunning,
  markReviewRunSucceeded,
  recoverRunningReviewRuns,
  replaceReviewRunFindings,
  requeueReviewRun,
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
      agent: 'janitor',
      scope: 'commit-diff',
    });
    expect(enqueue.inserted).toBe(true);

    const claimed = claimNextQueuedReviewRun(db, 1);
    expect(claimed?.id).toBe(enqueue.runId);

    markReviewRunRunning(db, enqueue.runId, 'sess-1');
    replaceReviewRunFindings(db, enqueue.runId, [
      {
        repo_id: repo.id,
        agent: 'janitor',
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
      agent: 'inspector',
      scope: 'repo',
    });

    claimNextQueuedReviewRun(db, 1);
    markReviewRunRunning(db, enqueue.runId, 'sess-arch');
    replaceReviewRunFindings(db, enqueue.runId, [
      {
        repo_id: repo.id,
        agent: 'inspector',
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
      agent: 'hunter',
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
      agent: 'scribe',
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
});

describe('event queries', () => {
  it('filters by review run and session id', () => {
    const db = createDb();
    const repo = seedRepo(db);
    const event = seedTriggerEvent(db, repo.id);
    const { runId } = enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: event.eventId,
      agent: 'janitor',
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
      agent: 'janitor',
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
