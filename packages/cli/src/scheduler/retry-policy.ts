import type { AgentRunOutcome } from '../db/models';

type ErrorType = 'transient' | 'terminal' | 'cancelled' | 'unknown';

export interface FailureClassification {
  outcome: Exclude<AgentRunOutcome, 'succeeded'>;
  retryable: boolean;
  errorCode: string;
  errorType: Exclude<ErrorType, 'unknown'>;
}

export interface UnexpectedJobErrorClassification {
  retryable: boolean;
  errorCode: string;
  errorType: ErrorType;
  message: string;
}

const TRANSIENT_ERROR_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /rate limit/i,
  /too many requests/i,
  /econnreset/i,
  /econnrefused/i,
  /eai_again/i,
  /enotfound/i,
  /socket hang up/i,
  /network/i,
  /failed to fetch/i,
  /503/i,
  /504/i,
  /502/i,
  /429/i,
];

const TERMINAL_ERROR_PATTERNS = [
  /agent output parse failed/i,
  /invalid output/i,
  /schema validation failed/i,
  /invalid config/i,
  /permission denied/i,
  /401/i,
  /403/i,
  /not found/i,
];

const CANCELLED_ERROR_PATTERNS = [/cancelled/i, /canceled/i, /aborted/i];

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyCompletionFailure(
  type: 'timeout' | 'error' | 'cancelled',
): FailureClassification {
  if (type === 'cancelled') {
    return {
      outcome: 'cancelled',
      retryable: false,
      errorCode: 'AGENT_CANCELLED',
      errorType: 'cancelled',
    };
  }

  if (type === 'timeout') {
    return {
      outcome: 'failed_transient',
      retryable: true,
      errorCode: 'AGENT_TIMEOUT',
      errorType: 'transient',
    };
  }

  return {
    outcome: 'failed_transient',
    retryable: true,
    errorCode: 'AGENT_SESSION_ERROR',
    errorType: 'transient',
  };
}

export function classifyAgentFailure(error: unknown): FailureClassification {
  const message = toErrorMessage(error);

  if (CANCELLED_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      outcome: 'cancelled',
      retryable: false,
      errorCode: 'AGENT_CANCELLED',
      errorType: 'cancelled',
    };
  }

  if (TERMINAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      outcome: 'failed_terminal',
      retryable: false,
      errorCode: 'AGENT_TERMINAL',
      errorType: 'terminal',
    };
  }

  if (TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      outcome: 'failed_transient',
      retryable: true,
      errorCode: 'AGENT_TRANSIENT',
      errorType: 'transient',
    };
  }

  return {
    outcome: 'failed_terminal',
    retryable: false,
    errorCode: 'AGENT_ERROR',
    errorType: 'terminal',
  };
}

export function classifyUnexpectedJobError(
  error: unknown,
): UnexpectedJobErrorClassification {
  const message = toErrorMessage(error);

  if (CANCELLED_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      retryable: false,
      errorCode: 'JOB_CANCELLED',
      errorType: 'cancelled',
      message,
    };
  }

  if (TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      retryable: true,
      errorCode: 'JOB_RETRY_TRANSIENT',
      errorType: 'transient',
      message,
    };
  }

  if (TERMINAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      retryable: false,
      errorCode: 'JOB_ERROR_TERMINAL',
      errorType: 'terminal',
      message,
    };
  }

  return {
    retryable: false,
    errorCode: 'JOB_ERROR',
    errorType: 'unknown',
    message,
  };
}
