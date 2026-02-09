import type { Event, OpencodeClient, SessionStatus } from '@opencode-ai/sdk';

export type SessionCompletionOutcome =
  | { type: 'idle' }
  | { type: 'error'; message: string }
  | { type: 'timeout'; message: string }
  | { type: 'cancelled'; message: string };

export interface WaitForSessionOptions {
  directory: string;
  timeoutMs: number;
}

export interface SessionCompletionBus {
  start(): void;
  stop(message?: string): Promise<void>;
  waitFor(
    sessionId: string,
    options: WaitForSessionOptions,
  ): Promise<SessionCompletionOutcome>;
  cancel(sessionId: string, message?: string): void;
  cancelAll(message?: string): string[];
}

interface Waiter {
  promise: Promise<SessionCompletionOutcome>;
  resolve: (outcome: SessionCompletionOutcome) => void;
  timeout: ReturnType<typeof setTimeout>;
  directory: string;
}

interface SessionCompletionBusOptions {
  client: OpencodeClient;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

function sessionErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'unknown session error';
  }

  const named = error as { name?: unknown; data?: unknown };
  if (
    named.data &&
    typeof named.data === 'object' &&
    typeof (named.data as { message?: unknown }).message === 'string'
  ) {
    return (named.data as { message: string }).message;
  }

  if (typeof named.name === 'string' && named.name.length > 0) {
    return named.name;
  }

  return 'unknown session error';
}

export function createSessionCompletionBus(
  options: SessionCompletionBusOptions,
): SessionCompletionBus {
  const waiters = new Map<string, Waiter>();
  const reconnectBaseMs = options.reconnectBaseMs ?? 500;
  const reconnectMaxMs = options.reconnectMaxMs ?? 10_000;

  let running = false;
  let loopPromise: Promise<void> | undefined;
  let streamAbort: AbortController | undefined;

  const complete = (sessionId: string, outcome: SessionCompletionOutcome) => {
    const waiter = waiters.get(sessionId);
    if (!waiter) {
      return;
    }

    waiters.delete(sessionId);
    clearTimeout(waiter.timeout);
    waiter.resolve(outcome);
  };

  const cancelAll = (message: string): string[] => {
    const sessionIds = [...waiters.keys()];
    for (const sessionId of sessionIds) {
      complete(sessionId, {
        type: 'cancelled',
        message,
      });
    }
    return sessionIds;
  };

  const onEvent = (event: Event) => {
    if (event.type === 'session.status') {
      const { sessionID, status } = event.properties;
      if (status.type === 'idle') {
        complete(sessionID, { type: 'idle' });
      }
      return;
    }

    if (event.type === 'session.idle') {
      complete(event.properties.sessionID, { type: 'idle' });
      return;
    }

    if (event.type === 'session.error') {
      const sessionID = event.properties.sessionID;
      if (!sessionID) {
        return;
      }

      complete(sessionID, {
        type: 'error',
        message: sessionErrorMessage(event.properties.error),
      });
    }
  };

  const reconcileWaiters = async () => {
    if (waiters.size === 0) {
      return;
    }

    const directories = [
      ...new Set([...waiters.values()].map((w) => w.directory)),
    ];

    for (const directory of directories) {
      try {
        const statusRes = await options.client.session.status({
          query: { directory },
        });

        if (statusRes.error || !statusRes.data) {
          continue;
        }

        const statusBySession = statusRes.data as Record<string, SessionStatus>;
        for (const [sessionId, status] of Object.entries(statusBySession)) {
          if (status.type === 'idle') {
            complete(sessionId, { type: 'idle' });
          }
        }
      } catch {
        // Best-effort reconciliation.
      }
    }
  };

  const run = async () => {
    let attempts = 0;

    while (running) {
      const controller = new AbortController();
      streamAbort = controller;

      try {
        const subscription = await options.client.event.subscribe({
          signal: controller.signal,
        });

        attempts = 0;
        for await (const event of subscription.stream) {
          if (!running) {
            break;
          }

          onEvent(event as Event);
        }
      } catch {
        if (!running || controller.signal.aborted) {
          break;
        }
      } finally {
        if (streamAbort === controller) {
          streamAbort = undefined;
        }
      }

      if (!running) {
        break;
      }

      attempts += 1;
      await reconcileWaiters();

      const backoff = Math.min(
        reconnectBaseMs * 2 ** (attempts - 1),
        reconnectMaxMs,
      );
      const jitter = Math.floor(Math.random() * 250);
      await Bun.sleep(backoff + jitter);
    }
  };

  return {
    start() {
      if (running) {
        return;
      }

      running = true;
      loopPromise = run();
    },

    async stop(message = 'completion bus stopped') {
      if (!running) {
        cancelAll(message);
        return;
      }

      running = false;
      streamAbort?.abort();
      await loopPromise;
      loopPromise = undefined;

      cancelAll(message);
    },

    waitFor(sessionId, waitOptions) {
      const existing = waiters.get(sessionId);
      if (existing) {
        return existing.promise;
      }

      let resolve!: (outcome: SessionCompletionOutcome) => void;
      const promise = new Promise<SessionCompletionOutcome>((r) => {
        resolve = r;
      });

      const timeout = setTimeout(() => {
        complete(sessionId, {
          type: 'timeout',
          message: `session ${sessionId} did not reach idle before timeout`,
        });
      }, waitOptions.timeoutMs);

      waiters.set(sessionId, {
        promise,
        resolve,
        timeout,
        directory: waitOptions.directory,
      });

      return promise;
    },

    cancel(sessionId, message = 'session wait cancelled') {
      complete(sessionId, {
        type: 'cancelled',
        message,
      });
    },

    cancelAll(message = 'all session waits cancelled') {
      return cancelAll(message);
    },
  };
}
