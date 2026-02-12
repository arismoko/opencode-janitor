import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { CliConfigSchema } from '../config/schema';
import { ensureSchema } from '../db/migrations';
import { addRepo } from '../db/queries/repo-queries';
import { insertTriggerEvent } from '../db/queries/trigger-event-queries';
import { planReviewRunsForEvent } from './planner';

let db: Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  ensureSchema(db);
});

afterEach(() => {
  db.close();
});

describe('planReviewRunsForEvent', () => {
  it('plans default janitor run for commit trigger', () => {
    const repo = addRepo(db, {
      path: '/tmp/repo',
      gitDir: '/tmp/repo/.git',
      defaultBranch: 'main',
    });

    const event = insertTriggerEvent(db, {
      repoId: repo.id,
      triggerId: 'commit',
      eventKey: 'sha-1',
      subject: 'sha-1',
      payloadJson: JSON.stringify({ sha: 'sha-1' }),
      source: 'poll',
      detectedAt: Date.now(),
    });

    const result = planReviewRunsForEvent(
      db,
      CliConfigSchema.parse({}),
      event.eventId,
    );
    expect(result.planned).toBe(1);

    const rows = db
      .query('SELECT agent, scope FROM review_runs ORDER BY agent ASC')
      .all() as Array<{ agent: string; scope: string }>;
    expect(rows).toEqual([{ agent: 'janitor', scope: 'commit-diff' }]);
  });

  it('plans default hunter run for pr trigger', () => {
    const repo = addRepo(db, {
      path: '/tmp/repo',
      gitDir: '/tmp/repo/.git',
      defaultBranch: 'main',
    });

    const event = insertTriggerEvent(db, {
      repoId: repo.id,
      triggerId: 'pr',
      eventKey: '7:sha-2',
      subject: '7:sha-2',
      payloadJson: JSON.stringify({
        prNumber: 7,
        key: '7:sha-2',
        sha: 'sha-2',
      }),
      source: 'poll',
      detectedAt: Date.now(),
    });

    const result = planReviewRunsForEvent(
      db,
      CliConfigSchema.parse({}),
      event.eventId,
    );
    expect(result.planned).toBe(1);

    const rows = db
      .query('SELECT agent, scope FROM review_runs ORDER BY agent ASC')
      .all() as Array<{ agent: string; scope: string }>;
    expect(rows).toEqual([{ agent: 'hunter', scope: 'pr' }]);
  });

  it('manual hunter --pr keeps trigger manual and resolves scope=pr', () => {
    const repo = addRepo(db, {
      path: '/tmp/repo',
      gitDir: '/tmp/repo/.git',
      defaultBranch: 'main',
    });

    const event = insertTriggerEvent(db, {
      repoId: repo.id,
      triggerId: 'manual',
      eventKey: 'manual-pr-123',
      subject: 'manual:pr:123',
      payloadJson: JSON.stringify({
        agent: 'hunter',
        requestedScope: 'pr',
        input: { prNumber: 123 },
      }),
      source: 'cli',
      detectedAt: Date.now(),
    });

    const result = planReviewRunsForEvent(
      db,
      CliConfigSchema.parse({}),
      event.eventId,
    );
    expect(result.planned).toBe(1);

    const row = db
      .query('SELECT agent, scope, scope_input_json FROM review_runs LIMIT 1')
      .get() as { agent: string; scope: string; scope_input_json: string };
    expect(row.agent).toBe('hunter');
    expect(row.scope).toBe('pr');
    expect(JSON.parse(row.scope_input_json)).toEqual({ prNumber: 123 });
  });

  it('does not plan manual event when payload targets a different agent', () => {
    const repo = addRepo(db, {
      path: '/tmp/repo',
      gitDir: '/tmp/repo/.git',
      defaultBranch: 'main',
    });

    const event = insertTriggerEvent(db, {
      repoId: repo.id,
      triggerId: 'manual',
      eventKey: 'manual-target-hunter',
      subject: 'manual:hunter',
      payloadJson: JSON.stringify({
        agent: 'hunter',
      }),
      source: 'cli',
      detectedAt: Date.now(),
    });

    const result = planReviewRunsForEvent(
      db,
      CliConfigSchema.parse({}),
      event.eventId,
    );

    const rows = db
      .query('SELECT agent FROM review_runs ORDER BY agent ASC')
      .all() as Array<{ agent: string }>;

    expect(result.planned).toBe(1);
    expect(rows).toEqual([{ agent: 'hunter' }]);
  });

  it('honors hard auto capability gate from config', () => {
    const repo = addRepo(db, {
      path: '/tmp/repo',
      gitDir: '/tmp/repo/.git',
      defaultBranch: 'main',
    });

    const event = insertTriggerEvent(db, {
      repoId: repo.id,
      triggerId: 'commit',
      eventKey: 'sha-3',
      subject: 'sha-3',
      payloadJson: JSON.stringify({ sha: 'sha-3' }),
      source: 'poll',
      detectedAt: Date.now(),
    });

    const config = CliConfigSchema.parse({
      agents: {
        janitor: { autoTriggers: ['pr'] },
      },
    });

    const result = planReviewRunsForEvent(db, config, event.eventId);
    expect(result.planned).toBe(0);
  });
});
