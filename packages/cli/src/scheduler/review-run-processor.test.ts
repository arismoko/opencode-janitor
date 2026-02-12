import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { AGENT_IDS } from '@opencode-janitor/shared';
import { ensureSchema } from '../db/migrations';
import { listEvents } from '../db/queries/event-queries';
import { addRepo } from '../db/queries/repo-queries';
import {
  claimNextQueuedReviewRun,
  enqueueReviewRun,
} from '../db/queries/review-run-queries';
import { insertTriggerEvent } from '../db/queries/trigger-event-queries';
import { resolveHeadSha } from '../utils/git';
import { createReviewRunProcessor } from './review-run-processor';

const defaultAgent = AGENT_IDS[0];
const currentHeadSha = resolveHeadSha(process.cwd());

function setupClaimedRun(options?: {
  triggerId?: 'commit' | 'pr' | 'manual';
  payloadJson?: string;
  eventKey?: string;
  subject?: string;
}) {
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
    triggerId: options?.triggerId ?? 'commit',
    eventKey: options?.eventKey ?? 'sha-1',
    subject: options?.subject ?? 'sha-1',
    payloadJson: options?.payloadJson ?? JSON.stringify({}),
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
            agent: defaultAgent,
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

  it('posts PR comment once for successful PR-triggered run', async () => {
    const { db, run } = setupClaimedRun({
      triggerId: 'pr',
      eventKey: `42:${currentHeadSha}`,
      subject: `42:${currentHeadSha}`,
      payloadJson: JSON.stringify({ prNumber: 42, sha: currentHeadSha }),
    });

    const publishCalls: Array<{ runId: string; findingsCount: number }> = [];
    const persisted: Array<{ runId: string; findingsCount: number }> = [];

    const processor = createReviewRunProcessor({
      db,
      config: {
        scheduler: { retryBackoffMs: 1_000 },
        triggers: {
          pr: { postComment: true },
        },
      } as any,
      registry: {
        get: () =>
          ({
            agent: defaultAgent,
            prepareContext: () => ({
              reviewContext: {} as any,
              promptConfig: {} as any,
            }),
            buildPrompt: () => 'prompt',
            modelId: () => 'openai/gpt-5',
            parseOutput: () => ({ findings: [] }),
            onSuccess: () => [
              {
                repo_id: run.repo_id,
                agent: run.agent,
                severity: 'P1',
                domain: 'BUG',
                location: 'src/a.ts:1',
                evidence: 'evidence',
                prescription: 'fix',
                details_json: '{}',
                fingerprint: 'fp',
              },
            ],
          }) as any,
      } as any,
      client: {} as any,
      completionBus: {
        waitFor: () => Promise.resolve({ type: 'idle' }),
        cancel: () => {},
      } as any,
      persistence: {
        persistSucceeded: (targetRun, _session, findings) => {
          persisted.push({
            runId: targetRun.id,
            findingsCount: findings.length,
          });
        },
        persistFailureOrRetry: () => {
          throw new Error('unexpected persistFailureOrRetry');
        },
        persistMissingRuntimeSpec: () => {
          throw new Error('unexpected persistMissingRuntimeSpec');
        },
      },
      prCommentPublisher: async (targetRun, findings) => {
        publishCalls.push({
          runId: targetRun.id,
          findingsCount: findings.length,
        });
        return { ok: true, prNumber: 42 };
      },
      runner: {
        createReviewSession: async () => 'ses_pr_1',
        promptReviewAsync: async () => {},
        fetchAssistantOutput: async () => 'raw',
      },
    });

    await processor.process(run, new Map());

    expect(persisted).toEqual([{ runId: run.id, findingsCount: 1 }]);
    expect(publishCalls).toEqual([{ runId: run.id, findingsCount: 1 }]);
    const events = listEvents(db, 20);
    expect(
      events.some(
        (event) => event.event_type === 'review_run.pr_comment_posted',
      ),
    ).toBe(true);

    db.close();
  });

  it('does not post PR comment when triggers.pr.postComment is false', async () => {
    const { db, run } = setupClaimedRun({
      triggerId: 'pr',
      payloadJson: JSON.stringify({ prNumber: 43, sha: currentHeadSha }),
    });

    let publishCount = 0;
    const processor = createReviewRunProcessor({
      db,
      config: {
        scheduler: { retryBackoffMs: 1_000 },
        triggers: {
          pr: { postComment: false },
        },
      } as any,
      registry: {
        get: () =>
          ({
            agent: defaultAgent,
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
        cancel: () => {},
      } as any,
      persistence: {
        persistSucceeded: () => {},
        persistFailureOrRetry: () => {
          throw new Error('unexpected persistFailureOrRetry');
        },
        persistMissingRuntimeSpec: () => {
          throw new Error('unexpected persistMissingRuntimeSpec');
        },
      },
      prCommentPublisher: async () => {
        publishCount += 1;
        return { ok: true, prNumber: 43 };
      },
      runner: {
        createReviewSession: async () => 'ses_pr_2',
        promptReviewAsync: async () => {},
        fetchAssistantOutput: async () => 'raw',
      },
    });

    await processor.process(run, new Map());

    expect(publishCount).toBe(0);
    db.close();
  });

  it('keeps run success when PR comment publish fails', async () => {
    const { db, run } = setupClaimedRun({
      triggerId: 'pr',
      payloadJson: JSON.stringify({ prNumber: 44, sha: currentHeadSha }),
    });

    const persistedSuccess: string[] = [];
    const persistedFailures: string[] = [];

    const processor = createReviewRunProcessor({
      db,
      config: {
        scheduler: { retryBackoffMs: 1_000 },
        triggers: {
          pr: { postComment: true },
        },
      } as any,
      registry: {
        get: () =>
          ({
            agent: defaultAgent,
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
        cancel: () => {},
      } as any,
      persistence: {
        persistSucceeded: (targetRun) => {
          persistedSuccess.push(targetRun.id);
        },
        persistFailureOrRetry: (targetRun) => {
          persistedFailures.push(targetRun.id);
        },
        persistMissingRuntimeSpec: () => {
          throw new Error('unexpected persistMissingRuntimeSpec');
        },
      },
      prCommentPublisher: async () => ({
        ok: false,
        prNumber: 44,
        error: 'gh auth missing',
      }),
      runner: {
        createReviewSession: async () => 'ses_pr_3',
        promptReviewAsync: async () => {},
        fetchAssistantOutput: async () => 'raw',
      },
    });

    await processor.process(run, new Map());

    expect(persistedSuccess).toEqual([run.id]);
    expect(persistedFailures).toEqual([]);
    const events = listEvents(db, 20);
    expect(
      events.some(
        (event) => event.event_type === 'review_run.pr_comment_failed',
      ),
    ).toBe(true);

    db.close();
  });

  it('continues in-place when claimed run already has session_id', async () => {
    const { db, run } = setupClaimedRun();
    db.query('UPDATE review_runs SET session_id = ? WHERE id = ?').run(
      'ses_existing',
      run.id,
    );
    const runWithSession = { ...run, session_id: 'ses_existing' };

    let createSessionCalls = 0;
    const promptCalls: Array<{ sessionId: string }> = [];
    const processor = createReviewRunProcessor({
      db,
      config: {
        scheduler: { retryBackoffMs: 1_000 },
        triggers: { pr: { postComment: true } },
      } as any,
      registry: {
        get: () =>
          ({
            agent: defaultAgent,
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
        cancel: () => {},
      } as any,
      persistence: {
        persistSucceeded: () => {},
        persistFailureOrRetry: () => {
          throw new Error('unexpected persistFailureOrRetry');
        },
        persistMissingRuntimeSpec: () => {
          throw new Error('unexpected persistMissingRuntimeSpec');
        },
      },
      runner: {
        createReviewSession: async () => {
          createSessionCalls += 1;
          return 'ses_new';
        },
        promptReviewAsync: async (_client, args) => {
          promptCalls.push({ sessionId: args.sessionId });
        },
        fetchAssistantOutput: async () => 'raw',
      },
    });

    await processor.process(runWithSession as any, new Map());

    expect(createSessionCalls).toBe(0);
    expect(promptCalls).toEqual([{ sessionId: 'ses_existing' }]);

    db.close();
  });
});
