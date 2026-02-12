import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { AGENT_IDS } from '@opencode-janitor/shared';
import { z } from 'zod';
import { createTriggerStateStore } from '../state-store';
import { COMMIT_TRIGGER_MODULE } from './commit';
import { MANUAL_TRIGGER_MODULE } from './manual';

const defaultAgent = AGENT_IDS[0];

describe('trigger modules', () => {
  it('commit probe emits on first seen head and not on unchanged head', async () => {
    const repoPath = process.cwd();
    const first = await COMMIT_TRIGGER_MODULE.probe!({
      repoPath,
      state: {},
      config: { enabled: true, intervalSec: 15 },
    });

    expect(first.emissions.length).toBe(1);
    const sha = first.emissions[0]?.payload.sha;
    expect(typeof sha).toBe('string');

    const second = await COMMIT_TRIGGER_MODULE.probe!({
      repoPath,
      state: first.nextState,
      config: { enabled: true, intervalSec: 15 },
    });
    expect(second.emissions).toHaveLength(0);
  });

  it('manual module builds payload from request input', async () => {
    const payload = await MANUAL_TRIGGER_MODULE.fromManualRequest!({
      agent: defaultAgent,
      scope: 'pr',
      input: { prNumber: 123 },
      note: 'please review',
      focusPath: 'src/features/payments',
      sha: 'abc',
      prNumber: 123,
    });

    expect(payload.agent).toBe(defaultAgent);
    expect(payload.requestedScope).toBe('pr');
    expect(payload.input).toEqual({ prNumber: 123 });
    expect(payload.note).toBe('please review');
    expect(payload.focusPath).toBe('src/features/payments');
    expect(payload.sha).toBe('abc');
    expect(payload.prNumber).toBe(123);
  });

  it('manual module drops invalid fields via shared payload schema', async () => {
    const payload = await MANUAL_TRIGGER_MODULE.fromManualRequest!({
      agent: 'not-a-real-agent',
      scope: 'not-a-scope',
      input: ['bad'],
      note: 123,
      prNumber: -1,
    });

    expect(payload).toEqual({});
  });
});

describe('trigger state store', () => {
  it('loads default state, saves state, and lists due repo ids', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE trigger_states (
        repo_id TEXT NOT NULL,
        trigger_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        next_check_at INTEGER,
        last_checked_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (repo_id, trigger_id)
      ) STRICT;
    `);

    const store = createTriggerStateStore(db);
    const schema = z.object({ lastHeadSha: z.string().optional() });

    const initial = store.load('repo-1', 'commit', schema);
    expect(initial).toEqual({});

    store.save('repo-1', 'commit', { lastHeadSha: 'abc' }, Date.now() - 1000);
    const loaded = store.load('repo-1', 'commit', schema);
    expect(loaded.lastHeadSha).toBe('abc');

    const due = store.listDue('commit', Date.now(), 10);
    expect(due).toEqual(['repo-1']);

    db.close();
  });
});
