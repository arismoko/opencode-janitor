import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import { AGENT_IDS } from '@opencode-janitor/shared';
import { ensureSchema } from '../db/migrations';
import { addRepo } from '../db/queries/repo-queries';
import type { QueuedReviewRunRow } from '../db/queries/review-run-queries';
import { insertTriggerEvent } from '../db/queries/trigger-event-queries';
import {
  createReviewRunPersistenceService,
  type SessionResult,
} from './review-run-persistence';

function createDb(): Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
}

const testAgentId = AGENT_IDS[0]!;

function createMockRun(
  overrides?: Partial<QueuedReviewRunRow>,
): QueuedReviewRunRow {
  return {
    id: 'run-1',
    repo_id: 'repo-1',
    trigger_event_id: 'event-123',
    trigger_id: 'manual',
    scope: 'workspace-diff',
    agent: testAgentId,
    attempt: 1,
    max_attempts: 3,
    next_attempt_at: Date.now(),
    queued_at: Date.now(),
    path: '/tmp/repo',
    default_branch: 'main',
    scope_input_json: '{}',
    subject: 'manual:test',
    payload_json: '{}',
    session_id: null,
    ...overrides,
  };
}

describe('createReviewRunPersistenceService', () => {
  let db: Database;
  let repoId: string;

  beforeEach(() => {
    db = createDb();
    const repo = addRepo(db, {
      path: '/tmp/repo',
      gitDir: '/tmp/repo/.git',
      defaultBranch: 'main',
    });
    repoId = repo.id;

    insertTriggerEvent(db, {
      repoId: repo.id,
      triggerId: 'manual',
      eventKey: 'key-1',
      subject: 'subject',
      payloadJson: '{}',
      source: 'cli',
      detectedAt: Date.now(),
    });
  });

  describe('persistSucceeded', () => {
    it('includes triggerEventId in review_run.succeeded payload', () => {
      const service = createReviewRunPersistenceService({
        db,
        retryBackoffMs: 1000,
      });

      const run = createMockRun({ repo_id: repoId });
      const session: SessionResult = {
        sessionId: 'session-1',
        rawOutput: 'output',
      };

      service.persistSucceeded(run, session, []);

      const event = db
        .query(
          `SELECT payload_json FROM event_journal WHERE event_type = 'review_run.succeeded'`,
        )
        .get() as { payload_json: string } | undefined;

      expect(event).toBeDefined();
      const payload = JSON.parse(event!.payload_json);
      expect(payload.reviewRunId).toBe('run-1');
      expect(payload.triggerEventId).toBe('event-123');
    });
  });

  describe('persistFailureOrRetry', () => {
    it('includes triggerEventId in review_run.requeued payload', () => {
      const service = createReviewRunPersistenceService({
        db,
        retryBackoffMs: 1000,
      });

      const run = createMockRun({
        repo_id: repoId,
        attempt: 1,
        max_attempts: 3,
      });
      const error = new Error('timeout: request timed out');

      service.persistFailureOrRetry(run, error);

      const event = db
        .query(
          `SELECT payload_json FROM event_journal WHERE event_type = 'review_run.requeued'`,
        )
        .get() as { payload_json: string } | undefined;

      expect(event).toBeDefined();
      const payload = JSON.parse(event!.payload_json);
      expect(payload.reviewRunId).toBe('run-1');
      expect(payload.triggerEventId).toBe('event-123');
    });

    it('includes triggerEventId in review_run.failed payload (terminal)', () => {
      const service = createReviewRunPersistenceService({
        db,
        retryBackoffMs: 1000,
      });

      const run = createMockRun({
        repo_id: repoId,
        attempt: 3,
        max_attempts: 3,
      });
      const error = new Error('terminal failure');

      service.persistFailureOrRetry(run, error);

      const event = db
        .query(
          `SELECT payload_json FROM event_journal WHERE event_type = 'review_run.failed'`,
        )
        .get() as { payload_json: string } | undefined;

      expect(event).toBeDefined();
      const payload = JSON.parse(event!.payload_json);
      expect(payload.reviewRunId).toBe('run-1');
      expect(payload.triggerEventId).toBe('event-123');
    });

    it('includes triggerEventId in review_run.cancelled payload', () => {
      const service = createReviewRunPersistenceService({
        db,
        retryBackoffMs: 1000,
      });

      const run = createMockRun({
        repo_id: repoId,
        attempt: 1,
        max_attempts: 3,
      });
      const cancelledError = new Error('request was cancelled');

      service.persistFailureOrRetry(run, cancelledError);

      const event = db
        .query(
          `SELECT payload_json FROM event_journal WHERE event_type = 'review_run.cancelled'`,
        )
        .get() as { payload_json: string } | undefined;

      expect(event).toBeDefined();
      const payload = JSON.parse(event!.payload_json);
      expect(payload.reviewRunId).toBe('run-1');
      expect(payload.triggerEventId).toBe('event-123');
    });
  });
});
