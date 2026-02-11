import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { CliConfigSchema } from '../config/schema';
import { ensureSchema } from '../db/migrations';
import { addRepo } from '../db/queries/repo-queries';
import { runTriggerEngineTick } from './engine';

describe('runTriggerEngineTick', () => {
  it('inserts trigger_events and deduped queued jobs from emissions', async () => {
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
        pr: { enabled: true, intervalSec: 1, ttlSec: 1 },
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
    const firstJobs = db
      .query('SELECT COUNT(*) AS count FROM review_jobs WHERE repo_id = ?')
      .get(repo.id) as { count: number };
    expect(firstEvents.count).toBe(1);
    expect(firstJobs.count).toBe(1);

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
    const secondJobs = db
      .query('SELECT COUNT(*) AS count FROM review_jobs WHERE repo_id = ?')
      .get(repo.id) as { count: number };
    expect(secondEvents.count).toBe(1);
    expect(secondJobs.count).toBe(1);

    db.close();
  });
});
