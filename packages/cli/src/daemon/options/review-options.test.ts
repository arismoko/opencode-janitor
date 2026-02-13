import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { AGENT_IDS, AGENTS, type AgentName } from '@opencode-janitor/shared';
import { CliConfigSchema } from '../../config/schema';
import { ensureSchema } from '../../db/migrations';
import { addRepo } from '../../db/queries/repo-queries';
import type { RuntimeContext } from '../../runtime/context';
import { createReviewOptions } from './review-options';

function createDb(): Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
}

function createRuntimeContext(
  db: Database,
  configInput: Record<string, unknown>,
) {
  const config = CliConfigSchema.parse(configInput);
  return {
    db,
    config,
    dbPath: ':memory:',
    startedAt: Date.now(),
    scheduler: { wake: () => {} },
    completionBus: { cancel: () => {}, take: () => null },
    child: { client: null },
    lock: { release: () => {} },
    watch: { stop: () => {} },
    registry: { register: () => {}, get: () => null },
  } as unknown as RuntimeContext;
}

function pickRepoCapableAgent(): AgentName {
  const id = AGENT_IDS.find((agent) =>
    AGENTS[agent].capabilities.manualScopes.includes('repo'),
  );
  if (!id) {
    throw new Error('Expected at least one agent with repo manual scope');
  }
  return id;
}

function pickPrCapableAgent(): AgentName {
  const id = AGENT_IDS.find((agent) =>
    AGENTS[agent].capabilities.manualScopes.includes('pr'),
  );
  if (!id) {
    throw new Error('Expected at least one agent with pr manual scope');
  }
  return id;
}

describe('createReviewOptions', () => {
  it('rejects manual enqueue when manual trigger is disabled', async () => {
    const db = createDb();
    const repo = addRepo(db, {
      path: '/tmp/review-options-manual-disabled',
      gitDir: '/tmp/review-options-manual-disabled/.git',
      defaultBranch: 'main',
    });
    const agent = pickRepoCapableAgent();

    const rc = createRuntimeContext(db, {
      triggers: { manual: { enabled: false } },
    });
    const options = createReviewOptions(rc, {
      hasWorkspaceDiff: () => false,
      resolveHeadSha: () => 'sha-main',
      resolvePrHeadShaAsync: async () => 'sha-pr',
    });

    await expect(
      options.onEnqueueReview({ repoOrId: repo.id, agent }),
    ).rejects.toThrow('Manual trigger is disabled by config');

    const events = db
      .query('SELECT id FROM trigger_events ORDER BY detected_at DESC')
      .all() as Array<{ id: string }>;
    expect(events).toHaveLength(0);
  });

  it('applies configured manualDefaultScope for repo scope when request omits scope', async () => {
    const db = createDb();
    const repo = addRepo(db, {
      path: '/tmp/review-options-manual-default',
      gitDir: '/tmp/review-options-manual-default/.git',
      defaultBranch: 'main',
    });
    const agent = pickRepoCapableAgent();

    const rc = createRuntimeContext(db, {
      agents: {
        [agent]: { manualDefaultScope: 'repo' },
      },
    });
    const options = createReviewOptions(rc, {
      hasWorkspaceDiff: () => true,
      resolveHeadSha: () => 'sha-main',
      resolvePrHeadShaAsync: async () => 'sha-pr',
    });

    const response = await options.onEnqueueReview({
      repoOrId: repo.path,
      agent,
    });
    expect(response.enqueued).toBe(true);

    const run = db
      .query('SELECT scope, scope_input_json FROM review_runs LIMIT 1')
      .get() as { scope: string; scope_input_json: string };
    expect(run.scope).toBe('repo');
    expect(JSON.parse(run.scope_input_json)).toEqual({});

    const event = db
      .query('SELECT payload_json FROM trigger_events LIMIT 1')
      .get() as { payload_json: string };
    const payload = JSON.parse(event.payload_json) as {
      requestedScope?: string;
    };
    expect(payload.requestedScope).toBe('repo');
  });

  it('applies configured manualDefaultScope for pr scope and keeps pr input', async () => {
    const db = createDb();
    const repo = addRepo(db, {
      path: '/tmp/review-options-pr-default',
      gitDir: '/tmp/review-options-pr-default/.git',
      defaultBranch: 'main',
    });
    const agent = pickPrCapableAgent();

    const rc = createRuntimeContext(db, {
      agents: {
        [agent]: { manualDefaultScope: 'pr' },
      },
    });
    const options = createReviewOptions(rc, {
      hasWorkspaceDiff: () => false,
      resolveHeadSha: () => 'sha-main',
      resolvePrHeadShaAsync: async () => 'sha-pr-77',
    });

    const response = await options.onEnqueueReview({
      repoOrId: repo.id,
      agent,
      input: { prNumber: 77 },
    });

    expect(response.enqueued).toBe(true);
    expect(response.sha).toBe('sha-pr-77');

    const run = db
      .query('SELECT scope, scope_input_json FROM review_runs LIMIT 1')
      .get() as { scope: string; scope_input_json: string };
    expect(run.scope).toBe('pr');
    expect(JSON.parse(run.scope_input_json)).toEqual({ prNumber: 77 });
  });

  it('ignores stray input.prNumber when resolved scope is non-PR', async () => {
    const db = createDb();
    const repo = addRepo(db, {
      path: '/tmp/review-options-stray-pr',
      gitDir: '/tmp/review-options-stray-pr/.git',
      defaultBranch: 'main',
    });
    const agent = pickRepoCapableAgent();
    let prResolverCalled = false;

    const rc = createRuntimeContext(db, {
      agents: {
        [agent]: { manualDefaultScope: 'repo' },
      },
    });
    const options = createReviewOptions(rc, {
      hasWorkspaceDiff: () => true,
      resolveHeadSha: () => 'sha-main',
      resolvePrHeadShaAsync: async () => {
        prResolverCalled = true;
        return 'sha-pr-999';
      },
    });

    const response = await options.onEnqueueReview({
      repoOrId: repo.path,
      agent,
      scope: 'repo',
      input: { prNumber: 999 },
    });

    expect(response.enqueued).toBe(true);
    expect(response.sha).toBe('sha-main');
    expect(prResolverCalled).toBe(false);

    const run = db
      .query('SELECT scope, scope_input_json FROM review_runs LIMIT 1')
      .get() as { scope: string; scope_input_json: string };
    expect(run.scope).toBe('repo');
    expect(JSON.parse(run.scope_input_json)).toEqual({});

    const event = db
      .query('SELECT payload_json FROM trigger_events LIMIT 1')
      .get() as { payload_json: string };
    const payload = JSON.parse(event.payload_json) as {
      prNumber?: number;
      requestedScope?: string;
    };
    expect(payload.prNumber).toBeUndefined();
    expect(payload.requestedScope).toBe('repo');
  });
});
