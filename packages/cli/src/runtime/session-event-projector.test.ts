import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { Event } from '@opencode-ai/sdk';
import { ensureSchema } from '../db/migrations';
import { listEvents } from '../db/queries/event-queries';
import { addRepo } from '../db/queries/repo-queries';
import {
  enqueueReviewRun,
  markReviewRunRunning,
} from '../db/queries/review-run-queries';
import { insertTriggerEvent } from '../db/queries/trigger-event-queries';
import { createSessionEventProjector } from './session-event-projector';

describe('session-event-projector', () => {
  it('maps structured message.part.updated events into journal topics', () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    ensureSchema(db);

    const repo = addRepo(db, {
      path: process.cwd(),
      gitDir: `${process.cwd()}/.git`,
      defaultBranch: 'main',
    });

    const inserted = insertTriggerEvent(db, {
      repoId: repo.id,
      triggerId: 'manual',
      eventKey: 'manual-1',
      subject: 'manual:auto',
      payloadJson: JSON.stringify({ agent: 'janitor' }),
      source: 'cli',
      detectedAt: Date.now(),
    });

    const run = enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: inserted.eventId,
      agent: 'janitor',
      scope: 'repo',
      scopeInputJson: '{}',
      maxAttempts: 3,
    });

    markReviewRunRunning(db, run.runId, 'ses_123');

    const projector = createSessionEventProjector(db);

    projector.handle({
      type: 'message.part.updated',
      properties: {
        delta: 'Hello ',
        part: {
          type: 'text',
          id: 'part_text',
          messageID: 'msg_1',
          sessionID: 'ses_123',
          text: 'Hello world',
        },
      },
    } as Event);

    projector.handle({
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'text',
          id: 'part_text',
          messageID: 'msg_1',
          sessionID: 'ses_123',
          text: 'Hello world',
        },
      },
    } as Event);

    projector.handle({
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          id: 'part_tool',
          messageID: 'msg_2',
          sessionID: 'ses_123',
          tool: 'bash',
          callID: 'call_1',
          state: {
            status: 'running',
            input: { command: 'ls -la' },
            title: 'List files',
            time: { start: Date.now() },
          },
        },
      },
    } as Event);

    projector.handle({
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          id: 'part_tool',
          messageID: 'msg_2',
          sessionID: 'ses_123',
          tool: 'bash',
          callID: 'call_1',
          state: {
            status: 'completed',
            output: 'x'.repeat(600),
            title: 'List files',
            time: { start: 10, end: 25 },
          },
        },
      },
    } as Event);

    const events = listEvents(db, 20).reverse();
    expect(events.map((e) => e.event_type)).toEqual([
      'session.delta',
      'session.text',
      'session.tool.start',
      'session.tool.completed',
    ]);

    const completedPayload = JSON.parse(events[3]!.payload_json) as Record<
      string,
      unknown
    >;
    expect(completedPayload.sessionId).toBe('ses_123');
    expect(typeof completedPayload.output).toBe('string');
    expect((completedPayload.output as string).length).toBe(501);
    expect((completedPayload.output as string).endsWith('…')).toBe(true);
    expect(completedPayload.durationMs).toBe(15);

    for (const event of events) {
      expect(event.repo_id).toBe(repo.id);
      expect(event.trigger_event_id).toBe(inserted.eventId);
      expect(event.review_run_id).toBe(run.runId);
    }

    db.close();
  });

  it('ignores events when no running review run context is found', () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    ensureSchema(db);

    const repo = addRepo(db, {
      path: process.cwd(),
      gitDir: `${process.cwd()}/.git`,
      defaultBranch: 'main',
    });

    const inserted = insertTriggerEvent(db, {
      repoId: repo.id,
      triggerId: 'manual',
      eventKey: 'manual-2',
      subject: 'manual:auto',
      payloadJson: JSON.stringify({ agent: 'janitor' }),
      source: 'cli',
      detectedAt: Date.now(),
    });

    // Run remains queued (not running), so projector should ignore session events.
    enqueueReviewRun(db, {
      repoId: repo.id,
      triggerEventId: inserted.eventId,
      agent: 'janitor',
      scope: 'repo',
      scopeInputJson: '{}',
      maxAttempts: 3,
    });

    const projector = createSessionEventProjector(db);
    projector.handle({
      type: 'session.idle',
      properties: {
        sessionID: 'missing_session',
      },
    } as Event);

    expect(listEvents(db, 10)).toHaveLength(0);

    db.close();
  });
});
