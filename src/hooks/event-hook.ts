/**
 * Event hook — review completion detection + session event logging.
 *
 * Handles:
 * - Streaming events for tracked sessions to JSONL files
 * - Review session completion (session.status → idle)
 * - Review session error (session.error) — with decoupled queue release
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeContext } from '../runtime/context';
import { atomicWriteSync } from '../utils/atomic-write';
import { appendEvent } from '../utils/event-log';
import { warn } from '../utils/logger';

/**
 * Create the event hook handler.
 *
 * BUG FIX: `session.error` now forwards to queue failure handlers
 * OUTSIDE the `trackedSessions.has()` guard. A failed session must
 * release its queue slot even if metadata tracking diverges (e.g.
 * session was never tracked, or was already removed from tracking).
 */
export function createEventHook(
  rc: RuntimeContext,
): (input: {
  event: { type: string; properties?: Record<string, unknown> };
}) => Promise<void> {
  return async (input) => {
    if (rc.runtime.disposed) return;
    const { event } = input;

    // Stream events for tracked sessions to JSONL
    const eventSessionId = (event.properties?.sessionID ??
      (event.properties?.part as { sessionID?: string })?.sessionID) as
      | string
      | undefined;
    if (eventSessionId && rc.trackedSessions.has(eventSessionId)) {
      try {
        appendEvent(rc.stateDir, eventSessionId, event);
      } catch (err) {
        warn('[session-event] failed to append event', {
          error: String(err),
        });
      }
    }

    // Detect review session completion
    if (event.type === 'session.status') {
      const props = event.properties as
        | { status?: { type?: string }; sessionID?: string }
        | undefined;
      if (props?.status?.type === 'idle' && props?.sessionID) {
        // Update session metadata to reflect completion
        if (rc.trackedSessions.has(props.sessionID)) {
          try {
            const metaPath = join(rc.stateDir, `${props.sessionID}.json`);
            const existing = JSON.parse(readFileSync(metaPath, 'utf-8'));
            existing.status = 'completed';
            existing.completedAt = Date.now();
            atomicWriteSync(metaPath, JSON.stringify(existing, null, 2));
          } catch (err) {
            warn(
              '[session-event] failed to update completed session metadata',
              {
                error: String(err),
              },
            );
          }
          rc.trackedSessions.delete(props.sessionID);
        }

        await rc.orchestrator.handleCompletion(
          props.sessionID,
          rc.ctx,
          rc.config,
        );
        await rc.hunterOrchestrator.handleCompletion(
          props.sessionID,
          rc.ctx,
          rc.config,
        );
      }
    }

    // Detect review session error
    // BUG FIX: handleFailure calls are OUTSIDE the trackedSessions guard.
    // If tracking diverges, the queue slot is still released.
    if (event.type === 'session.error') {
      const props = event.properties as
        | { error?: { message?: string }; sessionID?: string }
        | undefined;

      if (props?.sessionID) {
        // Update metadata if we were tracking this session
        if (rc.trackedSessions.has(props.sessionID)) {
          try {
            const metaPath = join(rc.stateDir, `${props.sessionID}.json`);
            const existing = JSON.parse(readFileSync(metaPath, 'utf-8'));
            existing.status = 'failed';
            existing.completedAt = Date.now();
            existing.error = props.error?.message ?? 'unknown error';
            atomicWriteSync(metaPath, JSON.stringify(existing, null, 2));
          } catch (err) {
            warn('[session-event] failed to update failed session metadata', {
              error: String(err),
            });
          }
          rc.trackedSessions.delete(props.sessionID);
        }

        // Always forward to queue handlers — they use their own
        // sessionToKey map to determine ownership. This ensures
        // queue slots are released even if trackedSessions diverges.
        rc.orchestrator.handleFailure(
          props.sessionID,
          props.error?.message ?? 'unknown error',
        );
        rc.hunterOrchestrator.handleFailure(
          props.sessionID,
          props.error?.message ?? 'unknown error',
        );
      }
    }
  };
}
