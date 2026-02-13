import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { CliConfigSchema } from '../config/schema';
import { ensureSchema } from '../db/migrations';
import { addRepo } from '../db/queries/repo-queries';
import { upsertTriggerState } from '../db/queries/trigger-state-queries';
import { runTriggerEngineTick } from './engine';
import { createPrTriggerModule } from './modules/pr';

describe('runTriggerEngineTick', () => {
  it('inserts trigger_events and deduped review_runs from emissions', async () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    ensureSchema(db);

    const repo = addRepo(db, {
      path: process.cwd(),
      gitDir: `${process.cwd()}/.git`,
      defaultBranch: 'main',
    });

    const config = CliConfigSchema.parse({
      triggers: {
        commit: { enabled: true, intervalSec: 1 },
        pr: { enabled: true, intervalSec: 1 },
      },
    });

    const commitModule = {
      stateSchema: z.object({ count: z.number().default(0) }),
      probe: async ({ state }: { state: Record<string, unknown> }) => {
        const count = Number(state.count ?? 0);
        const detectedAt = Date.now();
        if (count > 0) {
          return {
            nextState: { count: count + 1 },
            emissions: [],
          };
        }
        return {
          nextState: { count: 1 },
          emissions: [
            {
              eventKey: 'sha-1',
              payload: { sha: 'sha-1' },
              detectedAt,
            },
          ],
        };
      },
      buildSubject: (payload: Record<string, unknown>) =>
        String(payload.sha ?? ''),
    };

    const prModule = {
      stateSchema: z.object({}),
      probe: async () => ({ nextState: {}, emissions: [] as never[] }),
      buildSubject: () => 'noop',
    };

    await runTriggerEngineTick({
      db,
      config,
      maxAttempts: 3,
      modules: {
        commit: commitModule,
        pr: prModule,
      },
    });

    const firstEvents = db
      .query('SELECT COUNT(*) AS count FROM trigger_events WHERE repo_id = ?')
      .get(repo.id) as { count: number };
    const firstRuns = db
      .query('SELECT COUNT(*) AS count FROM review_runs WHERE repo_id = ?')
      .get(repo.id) as { count: number };
    expect(firstEvents.count).toBe(1);
    expect(firstRuns.count).toBe(1);

    await runTriggerEngineTick({
      db,
      config,
      maxAttempts: 3,
      modules: {
        commit: commitModule,
        pr: prModule,
      },
    });

    const secondEvents = db
      .query('SELECT COUNT(*) AS count FROM trigger_events WHERE repo_id = ?')
      .get(repo.id) as { count: number };
    const secondRuns = db
      .query('SELECT COUNT(*) AS count FROM review_runs WHERE repo_id = ?')
      .get(repo.id) as { count: number };
    expect(secondEvents.count).toBe(1);
    expect(secondRuns.count).toBe(1);

    db.close();
  });

  it('probes bootstrap repos and skips repos scheduled in the future', async () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    ensureSchema(db);

    const blockedRepo = addRepo(db, {
      path: `${process.cwd()}/blocked`,
      gitDir: `${process.cwd()}/blocked/.git`,
      defaultBranch: 'main',
    });
    const bootstrapRepo = addRepo(db, {
      path: `${process.cwd()}/bootstrap`,
      gitDir: `${process.cwd()}/bootstrap/.git`,
      defaultBranch: 'main',
    });

    // Existing state row with a future next_check_at => not due.
    upsertTriggerState(db, {
      repoId: blockedRepo.id,
      triggerId: 'commit',
      stateJson: JSON.stringify({ count: 0 }),
      nextCheckAt: Date.now() + 60_000,
      lastCheckedAt: Date.now(),
    });

    const config = CliConfigSchema.parse({
      triggers: {
        commit: { enabled: true, intervalSec: 1 },
        pr: { enabled: false, intervalSec: 1 },
      },
    });

    const commitModule = {
      stateSchema: z.object({ count: z.number().default(0) }),
      probe: async ({ state }: { state: Record<string, unknown> }) => {
        const count = Number(state.count ?? 0);
        return {
          nextState: { count: count + 1 },
          emissions: [
            {
              eventKey: `sha-${count + 1}`,
              payload: { sha: `sha-${count + 1}` },
              detectedAt: Date.now(),
            },
          ],
        };
      },
      buildSubject: (payload: Record<string, unknown>) =>
        String(payload.sha ?? ''),
    };

    await runTriggerEngineTick({
      db,
      config,
      maxAttempts: 3,
      modules: {
        commit: commitModule,
      },
    });

    const blockedEvents = db
      .query('SELECT COUNT(*) AS count FROM trigger_events WHERE repo_id = ?')
      .get(blockedRepo.id) as { count: number };
    const bootstrapEvents = db
      .query('SELECT COUNT(*) AS count FROM trigger_events WHERE repo_id = ?')
      .get(bootstrapRepo.id) as { count: number };

    expect(blockedEvents.count).toBe(0);
    expect(bootstrapEvents.count).toBe(1);

    db.close();
  });

  it('unchanged pr key across ticks does not create a second event or run', async () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    ensureSchema(db);

    addRepo(db, {
      path: process.cwd(),
      gitDir: `${process.cwd()}/.git`,
      defaultBranch: 'main',
    });

    let now = 1_000;
    const prModule = createPrTriggerModule({
      now: () => now,
      resolveCurrentPrKeyAsync: async () => '7:abc123',
    });

    const commitModule = {
      stateSchema: z.object({}),
      probe: async () => ({ nextState: {}, emissions: [] as never[] }),
      buildSubject: () => 'noop',
    };

    const config = CliConfigSchema.parse({
      triggers: {
        commit: { enabled: false, intervalSec: 1 },
        pr: { enabled: true, intervalSec: 1 },
      },
    });

    const modules = {
      commit: commitModule,
      pr: prModule as unknown as typeof commitModule,
    };

    // Tick 1: bootstrap — emits initial PR event.
    await runTriggerEngineTick({ db, config, maxAttempts: 3, modules });

    const firstEvents = db
      .query('SELECT COUNT(*) AS count FROM trigger_events')
      .get() as { count: number };
    const firstRuns = db
      .query('SELECT COUNT(*) AS count FROM review_runs')
      .get() as { count: number };
    expect(firstEvents.count).toBe(1);
    expect(firstRuns.count).toBeGreaterThanOrEqual(1);

    // Advance time — same key, no re-emission.
    now = 999_000;

    // Tick 2: unchanged key — no new event, no new run.
    await runTriggerEngineTick({ db, config, maxAttempts: 3, modules });

    const secondEvents = db
      .query('SELECT COUNT(*) AS count FROM trigger_events')
      .get() as { count: number };
    const secondRuns = db
      .query('SELECT COUNT(*) AS count FROM review_runs')
      .get() as { count: number };
    expect(secondEvents.count).toBe(1);
    expect(secondRuns.count).toBe(firstRuns.count);

    db.close();
  });
});
