import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { AGENT_IDS, AGENTS } from '@opencode-janitor/shared';
import { CliConfigSchema } from '../config/schema';
import { ensureSchema } from '../db/migrations';
import { addRepo } from '../db/queries/repo-queries';
import { insertTriggerEvent } from '../db/queries/trigger-event-queries';
import { planReviewRunsForEvent } from './planner';

let db: Database;

const commitDefaultAgent = AGENT_IDS.find(
  (agentId) => AGENTS[agentId].defaults.autoTriggers[0] === 'commit',
);
const prDefaultAgent = AGENT_IDS.find(
  (agentId) => AGENTS[agentId].defaults.autoTriggers[0] === 'pr',
);
const prCapableAgent = AGENT_IDS.find((agentId) =>
  AGENTS[agentId].capabilities.manualScopes.includes('pr'),
);

if (!commitDefaultAgent || !prDefaultAgent || !prCapableAgent) {
  throw new Error('Expected canonical trigger-capable agents.');
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  ensureSchema(db);
});

afterEach(() => {
  db.close();
});

describe('planReviewRunsForEvent', () => {
  it('plans default commit agent run for commit trigger', () => {
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
    expect(rows).toEqual([{ agent: commitDefaultAgent, scope: 'commit-diff' }]);
  });

  it('plans default pr agent run for pr trigger', () => {
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
    expect(rows).toEqual([{ agent: prDefaultAgent, scope: 'pr' }]);
  });

  it('manual pr-capable agent with --pr keeps trigger manual and scope=pr', () => {
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
        agent: prCapableAgent,
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
    expect(row.agent).toBe(prCapableAgent);
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
      eventKey: 'manual-target-agent',
      subject: `manual:${prCapableAgent}`,
      payloadJson: JSON.stringify({
        agent: prCapableAgent,
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
    expect(rows).toEqual([{ agent: prCapableAgent }]);
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
        [commitDefaultAgent]: { autoTriggers: ['pr'] },
      },
    });

    const result = planReviewRunsForEvent(db, config, event.eventId);
    expect(result.planned).toBe(0);
  });
});
