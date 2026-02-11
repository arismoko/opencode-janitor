import type { Event } from '@opencode-ai/sdk';

export interface SessionCompletionSignal {
  sessionId: string;
  outcome: { type: 'idle' } | { type: 'error'; message: string };
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

export function getSessionId(event: Event): string | undefined {
  switch (event.type) {
    case 'session.status':
    case 'session.idle':
      return event.properties.sessionID;
    case 'session.error':
      return event.properties.sessionID ?? undefined;
    case 'message.part.updated':
      return event.properties.part.sessionID;
    default:
      return undefined;
  }
}

export function toCompletionSignal(
  event: Event,
): SessionCompletionSignal | null {
  if (event.type === 'session.status') {
    if (event.properties.status.type === 'idle') {
      return {
        sessionId: event.properties.sessionID,
        outcome: { type: 'idle' },
      };
    }
    return null;
  }

  if (event.type === 'session.idle') {
    return {
      sessionId: event.properties.sessionID,
      outcome: { type: 'idle' },
    };
  }

  if (event.type === 'session.error' && event.properties.sessionID) {
    return {
      sessionId: event.properties.sessionID,
      outcome: {
        type: 'error',
        message: sessionErrorMessage(event.properties.error),
      },
    };
  }

  return null;
}
