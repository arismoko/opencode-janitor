import type { Database } from 'bun:sqlite';
import type { Event } from '@opencode-ai/sdk';
import { appendEvent } from '../db/queries/event-queries';
import { findReviewRunContextBySessionId } from '../db/queries/review-run-queries';
import { getSessionId } from './session-event-utils';

export interface SessionEventProjector {
  handle(event: Event): void;
}

export function createSessionEventProjector(
  db: Database,
): SessionEventProjector {
  return {
    handle(event: Event): void {
      const sessionId = getSessionId(event);
      if (!sessionId) return;

      const ctx = findReviewRunContextBySessionId(db, sessionId);
      if (!ctx) return;

      const base = {
        repoId: ctx.repoId,
        triggerEventId: ctx.triggerEventId,
        reviewRunId: ctx.reviewRunId,
      };

      switch (event.type) {
        case 'message.part.updated': {
          const { delta, part } = event.properties;
          if (!delta) return;
          appendEvent(db, {
            ...base,
            eventType: 'session.delta',
            level: 'info',
            message: 'Session output chunk',
            payload: {
              sessionId,
              delta,
              partType: part.type,
              messageId: part.messageID,
              partId: part.id,
              agent: ctx.agent,
            },
          });
          return;
        }
        case 'session.status': {
          return;
        }
        case 'session.idle': {
          appendEvent(db, {
            ...base,
            eventType: 'session.idle',
            level: 'info',
            message: 'Session idle',
            payload: { sessionId },
          });
          return;
        }
        case 'session.error': {
          appendEvent(db, {
            ...base,
            eventType: 'session.error',
            level: 'error',
            message: 'Session error',
            payload: {
              sessionId,
              error: event.properties.error,
            },
          });
          return;
        }
      }
    },
  };
}
