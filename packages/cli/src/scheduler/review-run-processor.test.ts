import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { ensureSchema } from '../db/migrations';
import { addRepo } from '../db/queries/repo-queries';
import {
  claimNextQueuedReviewRun,
  enqueueReviewRun,
} from '../db/queries/review-run-queries';
import { insertTriggerEvent } from '../db/queries/trigger-event-queries';
import { createReviewRunProcessor } from './review-run-processor';

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
    payloadJson: JSON.stringify({}),
    source: 'poll',
    detectedAt: Date.now(),
  });

  enqueueReviewRun(db, {
    repoId: repo.id,
    triggerEventId: triggerEvent.eventId,
    agent: 'janitor',
    scope: 'commit-diff',
    scopeInputJson: '{}',
    maxAttempts: 3,
  });

  const run = claimNextQueuedReviewRun(db, 1);
  if (!run) {
    throw new Error('expected queued run to be claimable');
  }

  return { db, run };
}

describe('review run processor', () => {
  it('persists terminal missing-runtime-spec when no agent runtime is registered', async () => {
    const { db, run } = setupClaimedRun();

    let missingSpecCall: { runId: string; message: string } | undefined;
    const processor = createReviewRunProcessor({
      db,
      config: {} as any,
      registry: {
        get: () => undefined,
      } as any,
      client: {} as any,
      completionBus: {
        cancel: () => {},
      } as any,
      persistence: {
        persistSucceeded: () => {
          throw new Error('unexpected persistSucceeded');
        },
        persistFailureOrRetry: () => {
          throw new Error('unexpected persistFailureOrRetry');
        },
        persistMissingRuntimeSpec: (targetRun, message) => {
          missingSpecCall = { runId: targetRun.id, message };
        },
      },
    });

    await processor.process(run, new Map());

    expect(missingSpecCall).toEqual({
      runId: run.id,
      message: `No runtime spec registered for agent ${run.agent}`,
    });

    db.close();
  });

  it('cancels and aborts created session before persisting failure', async () => {
    const { db, run } = setupClaimedRun();

    const completionBusCalls: Array<{ sessionId: string; reason: string }> = [];
    const abortCalls: Array<{ sessionId: string; directory: string }> = [];
    const failureCalls: Array<{ runId: string; message: string }> = [];

    const processor = createReviewRunProcessor({
      db,
      config: {
        scheduler: { retryBackoffMs: 1_000 },
      } as any,
      registry: {
        get: () =>
          ({
            agent: 'janitor',
            prepareContext: () => ({
              reviewContext: {} as any,
              promptConfig: {} as any,
            }),
            buildPrompt: () => 'prompt',
            modelId: () => 'openai/gpt-5',
            parseOutput: () => ({ findings: [] }),
            onSuccess: () => [],
          }) as any,
      } as any,
      client: {} as any,
      completionBus: {
        waitFor: () => Promise.resolve({ type: 'idle' }),
        cancel: (sessionId: string, reason: string) => {
          completionBusCalls.push({ sessionId, reason });
        },
      } as any,
      persistence: {
        persistSucceeded: () => {
          throw new Error('unexpected persistSucceeded');
        },
        persistFailureOrRetry: (targetRun, error) => {
          failureCalls.push({ runId: targetRun.id, message: String(error) });
        },
        persistMissingRuntimeSpec: () => {
          throw new Error('unexpected persistMissingRuntimeSpec');
        },
      },
      runner: {
        createReviewSession: async () => 'ses_1',
        promptReviewAsync: async () => {
          throw new Error('network timeout while contacting upstream');
        },
        abortSession: async (_client, sessionId, directory) => {
          abortCalls.push({ sessionId, directory });
        },
        fetchAssistantOutput: async () => {
          throw new Error('unexpected fetchAssistantOutput');
        },
      },
    });

    const activeSessions = new Map();
    await processor.process(run, activeSessions);

    expect(completionBusCalls).toEqual([
      { sessionId: 'ses_1', reason: 'review run failed' },
    ]);
    expect(abortCalls).toEqual([{ sessionId: 'ses_1', directory: run.path }]);
    expect(failureCalls).toHaveLength(1);
    expect(failureCalls[0]?.runId).toBe(run.id);
    expect(failureCalls[0]?.message).toContain(
      'network timeout while contacting upstream',
    );
    expect(activeSessions.size).toBe(0);

    db.close();
  });
});
