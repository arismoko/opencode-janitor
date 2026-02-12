import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { AGENT_IDS } from '@opencode-janitor/shared';
import { ensureSchema } from '../db/migrations';
import { listEvents } from '../db/queries/event-queries';
import { addRepo } from '../db/queries/repo-queries';
import {
  claimNextQueuedReviewRun,
  enqueueReviewRun,
  getReviewRunById,
} from '../db/queries/review-run-queries';
import { insertTriggerEvent } from '../db/queries/trigger-event-queries';
import { createReviewRunPersistenceService } from './review-run-persistence';

const defaultAgent = AGENT_IDS[0];

function setupClaimedRun() {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  ensureSchema(db);

  const repo = addRepo(db, {
    path: process.cwd(),
    gitDir: `${process.cwd()}/.git`,
    defaultBranch: 'main',
  });

  const triggerEvent = insertTriggerEvent(db, {
    repoId: repo.id,
    triggerId: 'commit',
    eventKey: 'sha-1',
    subject: 'sha-1',
    payloadJson: JSON.stringify({ sha: 'sha-1' }),
    source: 'poll',
    detectedAt: Date.now(),
  });

  enqueueReviewRun(db, {
    repoId: repo.id,
    triggerEventId: triggerEvent.eventId,
    agent: defaultAgent,
    scope: 'commit-diff',
    scopeInputJson: '{}',
    maxAttempts: 3,
  });

  const run = claimNextQueuedReviewRun(db, 1);
  if (!run) {
    throw new Error('expected queued run to be claimable');
  }

  return { db, repo, triggerEventId: triggerEvent.eventId, run };
}

describe('review run persistence service', () => {
  it('persistSucceeded stores findings and emits correlated review_run.succeeded', () => {
    const { db, run } = setupClaimedRun();

    const persistence = createReviewRunPersistenceService({
      db,
      retryBackoffMs: 1_000,
    });
    persistence.persistSucceeded(
      run,
      {
        sessionId: 'ses_1',
        rawOutput: '{"findings":[]}',
      },
      [
        {
          repo_id: run.repo_id,
          agent: run.agent,
          severity: 'P1',
          domain: 'security',
          location: 'src/file.ts:10',
          evidence: 'unsafe pattern',
          prescription: 'fix it',
          details_json: '{}',
          fingerprint: 'fp-1',
        },
      ],
    );

    const row = getReviewRunById(db, run.id);
    expect(row?.status).toBe('succeeded');
    expect(row?.findings_count).toBe(1);

    const findingCount = db
      .query('SELECT COUNT(*) AS count FROM findings WHERE review_run_id = ?')
      .get(run.id) as { count: number };
    expect(findingCount.count).toBe(1);

    const event = listEvents(db, 1)[0];
    expect(event?.event_type).toBe('review_run.succeeded');
    expect(event?.repo_id).toBe(run.repo_id);
    expect(event?.trigger_event_id).toBe(run.trigger_event_id);
    expect(event?.review_run_id).toBe(run.id);

    const payload = JSON.parse(event?.payload_json ?? '{}') as {
      reviewRunId?: string;
      findingsCount?: number;
    };
    expect(payload.reviewRunId).toBe(run.id);
    expect(payload.findingsCount).toBe(1);

    db.close();
  });

  it('persistFailureOrRetry requeues retryable failures and emits review_run.requeued', () => {
    const { db, run } = setupClaimedRun();

    const persistence = createReviewRunPersistenceService({
      db,
      retryBackoffMs: 1_000,
    });

    persistence.persistFailureOrRetry(
      run,
      new Error('network timeout while contacting upstream'),
    );

    const row = getReviewRunById(db, run.id);
    expect(row?.status).toBe('queued');
    expect(row?.error_code).toBe('AGENT_TRANSIENT');

    const event = listEvents(db, 1)[0];
    expect(event?.event_type).toBe('review_run.requeued');
    expect(event?.repo_id).toBe(run.repo_id);
    expect(event?.trigger_event_id).toBe(run.trigger_event_id);
    expect(event?.review_run_id).toBe(run.id);

    const payload = JSON.parse(event?.payload_json ?? '{}') as {
      reviewRunId?: string;
    };
    expect(payload.reviewRunId).toBe(run.id);

    db.close();
  });

  it('persistFailureOrRetry marks terminal failures and emits review_run.failed', () => {
    const { db, run } = setupClaimedRun();

    const persistence = createReviewRunPersistenceService({
      db,
      retryBackoffMs: 1_000,
    });

    persistence.persistFailureOrRetry(
      run,
      new Error('invalid output schema validation failed'),
    );

    const row = getReviewRunById(db, run.id);
    expect(row?.status).toBe('failed');
    expect(row?.error_code).toBe('AGENT_TERMINAL');
    expect(row?.outcome).toBe('failed_terminal');

    const event = listEvents(db, 1)[0];
    expect(event?.event_type).toBe('review_run.failed');
    expect(event?.repo_id).toBe(run.repo_id);
    expect(event?.trigger_event_id).toBe(run.trigger_event_id);
    expect(event?.review_run_id).toBe(run.id);

    const payload = JSON.parse(event?.payload_json ?? '{}') as {
      reviewRunId?: string;
      errorCode?: string;
    };
    expect(payload.reviewRunId).toBe(run.id);
    expect(payload.errorCode).toBe('AGENT_TERMINAL');

    db.close();
  });

  it('persistFailureOrRetry marks cancelled outcomes as cancelled', () => {
    const { db, run } = setupClaimedRun();

    const persistence = createReviewRunPersistenceService({
      db,
      retryBackoffMs: 1_000,
    });

    persistence.persistFailureOrRetry(
      run,
      new Error('request cancelled by user'),
    );

    const row = getReviewRunById(db, run.id);
    expect(row?.status).toBe('cancelled');
    expect(row?.outcome).toBe('cancelled');
    expect(row?.error_code).toBe('AGENT_CANCELLED');

    const event = listEvents(db, 1)[0];
    expect(event?.event_type).toBe('review_run.cancelled');

    db.close();
  });
});
