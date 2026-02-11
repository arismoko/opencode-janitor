/**
 * SSE event stream adapter for dashboard live updates.
 *
 * Wraps `requestSse` from ../../ipc/client and emits typed callbacks
 * for each SSE event type the daemon produces on /v1/events/stream.
 */

import { requestSse } from '../../ipc/client';
import type { EventJournalEntry } from '../../ipc/protocol';

export interface EventStreamCallbacks {
  onReady?: (afterSeq: number) => void;
  onEvent?: (entry: EventJournalEntry) => void;
  onHeartbeat?: (afterSeq: number, ts: number) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

export interface EventStreamOptions {
  readonly socketPath: string;
  readonly afterSeq?: number;
  readonly pollMs?: number;
  readonly signal?: AbortSignal;
  /** Backend filter params — narrow the SSE stream server-side. */
  readonly repoId?: string;
  readonly jobId?: string;
  readonly agentRunId?: string;
  readonly topic?: string;
  readonly sessionId?: string;
}

/** Open an SSE connection to the daemon event stream. Returns when the stream closes. */
export async function openEventStream(
  options: EventStreamOptions,
  callbacks: EventStreamCallbacks,
): Promise<void> {
  const search = new URLSearchParams();
  if (options.afterSeq !== undefined) {
    search.set('afterSeq', String(options.afterSeq));
  }
  if (options.pollMs !== undefined) {
    search.set('pollMs', String(options.pollMs));
  }
  if (options.repoId) search.set('repoId', options.repoId);
  if (options.jobId) search.set('jobId', options.jobId);
  if (options.agentRunId) search.set('agentRunId', options.agentRunId);
  if (options.topic) search.set('topic', options.topic);
  if (options.sessionId) search.set('sessionId', options.sessionId);
  const qs = search.toString();
  const path = qs ? `/v1/events/stream?${qs}` : '/v1/events/stream';

  try {
    await requestSse({
      socketPath: options.socketPath,
      path,
      signal: options.signal,
      onEvent(event: string, payload: unknown) {
        switch (event) {
          case 'ready': {
            const data = payload as { afterSeq: number };
            callbacks.onReady?.(data.afterSeq);
            break;
          }
          case 'event': {
            callbacks.onEvent?.(payload as EventJournalEntry);
            break;
          }
          case 'heartbeat': {
            const data = payload as { afterSeq: number; ts: number };
            callbacks.onHeartbeat?.(data.afterSeq, data.ts);
            break;
          }
          case 'error': {
            const data = payload as { message: string };
            callbacks.onError?.(data.message);
            break;
          }
        }
      },
    });
  } finally {
    callbacks.onClose?.();
  }
}
