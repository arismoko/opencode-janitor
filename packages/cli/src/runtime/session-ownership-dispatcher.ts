import type { SessionCompletionOutcome } from './session-completion-bus';

interface OwnedSession {
  promise: Promise<SessionCompletionOutcome>;
  resolve: (outcome: SessionCompletionOutcome) => void;
  timeout: ReturnType<typeof setTimeout>;
  directory: string;
}

export interface RegisterSessionOptions {
  directory: string;
  timeoutMs: number;
}

/**
 * Session ownership dispatcher for completion waits.
 *
 * Maps `sessionId -> owner wait` and resolves outcomes via targeted dispatch.
 */
export class SessionOwnershipDispatcher {
  private readonly owners = new Map<string, OwnedSession>();

  register(
    sessionId: string,
    options: RegisterSessionOptions,
  ): Promise<SessionCompletionOutcome> {
    const existing = this.owners.get(sessionId);
    if (existing) {
      return existing.promise;
    }

    let resolve!: (outcome: SessionCompletionOutcome) => void;
    const promise = new Promise<SessionCompletionOutcome>((r) => {
      resolve = r;
    });

    const timeout = setTimeout(() => {
      this.resolve(sessionId, {
        type: 'timeout',
        message: `session ${sessionId} did not reach idle before timeout`,
      });
    }, options.timeoutMs);

    this.owners.set(sessionId, {
      promise,
      resolve,
      timeout,
      directory: options.directory,
    });

    return promise;
  }

  resolve(sessionId: string, outcome: SessionCompletionOutcome): boolean {
    const owner = this.owners.get(sessionId);
    if (!owner) {
      return false;
    }

    this.owners.delete(sessionId);
    clearTimeout(owner.timeout);
    owner.resolve(outcome);
    return true;
  }

  cancel(sessionId: string, message: string): boolean {
    return this.resolve(sessionId, {
      type: 'cancelled',
      message,
    });
  }

  cancelAll(message: string): string[] {
    const sessionIds = [...this.owners.keys()];
    for (const sessionId of sessionIds) {
      this.cancel(sessionId, message);
    }
    return sessionIds;
  }

  directories(): string[] {
    return [
      ...new Set([...this.owners.values()].map((owner) => owner.directory)),
    ];
  }
}
