import type { Database } from 'bun:sqlite';
import type { Event } from '@opencode-ai/sdk';
import { appendEvent } from '../db/queries/event-queries';
import { findReviewRunContextBySessionId } from '../db/queries/review-run-queries';
import { getSessionId } from './session-event-utils';

/**
 * Session Event Taxonomy
 * ─────────────────────────────────────────────────────────────────────────────
 * All events persisted by this projector carry:
 *   repoId, triggerEventId, reviewRunId  (from the review-run context)
 *
 * Topic names and payload shapes:
 *
 * ┌─────────────────────────┬────────────────────────────────────────────────┐
 * │ topic                   │ payload                                       │
 * ├─────────────────────────┼────────────────────────────────────────────────┤
 * │ session.delta           │ { sessionId, delta, partType, messageId,      │
 * │                         │   partId, agent }                             │
 * │ session.text            │ { sessionId, text, partId, messageId }        │
 * │ session.tool.start      │ { sessionId, tool, callId, partId, messageId, │
 * │                         │   input, title? }                             │
 * │ session.tool.completed  │ { sessionId, tool, callId, partId, messageId, │
 * │                         │   title, output(truncated), durationMs }      │
 * │ session.tool.error      │ { sessionId, tool, callId, partId, messageId, │
 * │                         │   error, durationMs }                         │
 * │ session.step.start      │ { sessionId, partId, messageId }              │
 * │ session.step.finish     │ { sessionId, partId, messageId, reason, cost, │
 * │                         │   tokens }                                    │
 * │ session.idle            │ { sessionId }                                 │
 * │ session.error           │ { sessionId, error }                          │
 * │ review_run.succeeded    │ { agent, findingsCount, reviewRunId }         │
 * │ review_run.failed       │ { agent, errorCode, reviewRunId }             │
 * │ review_run.requeued     │ { agent, reviewRunId }                        │
 * └─────────────────────────┴────────────────────────────────────────────────┘
 *
 * The review_run.* topics are emitted by the scheduler worker, not this
 * projector, but are documented here for completeness.
 */

const TOOL_OUTPUT_MAX = 500;

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

          // ── Text part: emit both streaming delta and completed text ───
          if (part.type === 'text') {
            if (delta) {
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
            }
            // Emit completed text snapshot when we have accumulated text and
            // no more delta (final update for the part).
            if (!delta && part.text) {
              appendEvent(db, {
                ...base,
                eventType: 'session.text',
                level: 'info',
                message: 'Text part completed',
                payload: {
                  sessionId,
                  text: part.text,
                  partId: part.id,
                  messageId: part.messageID,
                },
              });
            }
            return;
          }

          // ── Tool part: emit structured start/completed/error events ───
          if (part.type === 'tool') {
            const { state, tool, callID } = part;
            if (state.status === 'running') {
              appendEvent(db, {
                ...base,
                eventType: 'session.tool.start',
                level: 'info',
                message: `Tool call: ${tool}`,
                payload: {
                  sessionId,
                  tool,
                  callId: callID,
                  partId: part.id,
                  messageId: part.messageID,
                  input: state.input,
                  title: state.title,
                },
              });
              return;
            }
            if (state.status === 'completed') {
              const durationMs =
                state.time.end && state.time.start
                  ? state.time.end - state.time.start
                  : undefined;
              appendEvent(db, {
                ...base,
                eventType: 'session.tool.completed',
                level: 'info',
                message: `Tool completed: ${tool}`,
                payload: {
                  sessionId,
                  tool,
                  callId: callID,
                  partId: part.id,
                  messageId: part.messageID,
                  title: state.title,
                  output:
                    state.output.length > TOOL_OUTPUT_MAX
                      ? `${state.output.slice(0, TOOL_OUTPUT_MAX)}…`
                      : state.output,
                  durationMs,
                },
              });
              return;
            }
            if (state.status === 'error') {
              const durationMs =
                state.time.end && state.time.start
                  ? state.time.end - state.time.start
                  : undefined;
              appendEvent(db, {
                ...base,
                eventType: 'session.tool.error',
                level: 'warn',
                message: `Tool error: ${tool}`,
                payload: {
                  sessionId,
                  tool,
                  callId: callID,
                  partId: part.id,
                  messageId: part.messageID,
                  error: state.error,
                  durationMs,
                },
              });
              return;
            }
            // pending status — skip, wait for running/completed/error
            return;
          }

          // ── Step boundaries ───────────────────────────────────────────
          if (part.type === 'step-start') {
            appendEvent(db, {
              ...base,
              eventType: 'session.step.start',
              level: 'info',
              message: 'Step started',
              payload: {
                sessionId,
                partId: part.id,
                messageId: part.messageID,
              },
            });
            return;
          }

          if (part.type === 'step-finish') {
            appendEvent(db, {
              ...base,
              eventType: 'session.step.finish',
              level: 'info',
              message: `Step finished: ${part.reason}`,
              payload: {
                sessionId,
                partId: part.id,
                messageId: part.messageID,
                reason: part.reason,
                cost: part.cost,
                tokens: part.tokens,
              },
            });
            return;
          }

          // ── Reasoning part (delta only, same as text) ────────────────
          if (part.type === 'reasoning' && delta) {
            appendEvent(db, {
              ...base,
              eventType: 'session.delta',
              level: 'info',
              message: 'Session output chunk',
              payload: {
                sessionId,
                delta,
                partType: 'reasoning',
                messageId: part.messageID,
                partId: part.id,
                agent: ctx.agent,
              },
            });
            return;
          }

          return;
        }
        case 'session.status': {
          // Status events are handled by the session-completion-bus.
          // No journal entry needed.
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
