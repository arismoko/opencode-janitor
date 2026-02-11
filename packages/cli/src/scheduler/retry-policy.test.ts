import { describe, expect, it } from 'bun:test';
import {
  classifyAgentFailure,
  classifyCompletionFailure,
  classifyUnexpectedJobError,
} from './retry-policy';

// ---------------------------------------------------------------------------
// classifyCompletionFailure
// ---------------------------------------------------------------------------
describe('classifyCompletionFailure', () => {
  it.each([
    {
      type: 'cancelled' as const,
      expected: {
        outcome: 'cancelled',
        retryable: false,
        errorCode: 'AGENT_CANCELLED',
        errorType: 'cancelled',
      },
    },
    {
      type: 'timeout' as const,
      expected: {
        outcome: 'failed_transient',
        retryable: true,
        errorCode: 'AGENT_TIMEOUT',
        errorType: 'transient',
      },
    },
    {
      type: 'error' as const,
      expected: {
        outcome: 'failed_transient',
        retryable: true,
        errorCode: 'AGENT_SESSION_ERROR',
        errorType: 'transient',
      },
    },
  ])('classifies "$type" correctly', ({ type, expected }) => {
    expect(classifyCompletionFailure(type)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// classifyAgentFailure
// ---------------------------------------------------------------------------
describe('classifyAgentFailure', () => {
  // -- cancelled patterns (highest priority) --------------------------------
  describe('cancelled errors (highest priority)', () => {
    it.each([
      'Request cancelled by user',
      'Operation was canceled',
      'Connection aborted',
    ])('classifies "%s" as cancelled', (msg) => {
      const result = classifyAgentFailure(new Error(msg));
      expect(result).toEqual({
        outcome: 'cancelled',
        retryable: false,
        errorCode: 'AGENT_CANCELLED',
        errorType: 'cancelled',
      });
    });
  });

  // -- terminal patterns ----------------------------------------------------
  describe('terminal errors', () => {
    it.each([
      'agent output parse failed',
      'invalid output from model',
      'schema validation failed for response',
      'invalid config detected',
      'permission denied accessing resource',
      'HTTP 401 Unauthorized',
      'HTTP 403 Forbidden',
      'resource not found',
    ])('classifies "%s" as terminal (not retryable)', (msg) => {
      const result = classifyAgentFailure(new Error(msg));
      expect(result.outcome).toBe('failed_terminal');
      expect(result.retryable).toBe(false);
      expect(result.errorCode).toBe('AGENT_TERMINAL');
      expect(result.errorType).toBe('terminal');
    });
  });

  // -- transient patterns ---------------------------------------------------
  describe('transient errors', () => {
    it.each([
      'request timeout after 30s',
      'connection timed out',
      'service temporarily unavailable',
      'service unavailable, try again',
      'rate limit exceeded',
      'too many requests',
      'ECONNRESET',
      'ECONNREFUSED on port 443',
      'EAI_AGAIN dns failure',
      'ENOTFOUND api.example.com',
      'socket hang up',
      'network error',
      'failed to fetch response',
      'HTTP 503 Service Unavailable',
      'HTTP 504 Gateway Timeout',
      'HTTP 502 Bad Gateway',
      'HTTP 429 Too Many Requests',
    ])('classifies "%s" as transient (retryable)', (msg) => {
      const result = classifyAgentFailure(new Error(msg));
      expect(result.outcome).toBe('failed_transient');
      expect(result.retryable).toBe(true);
      expect(result.errorCode).toBe('AGENT_TRANSIENT');
      expect(result.errorType).toBe('transient');
    });
  });

  // -- unknown / default (terminal) -----------------------------------------
  describe('unknown errors default to terminal', () => {
    it.each([
      'something completely unexpected',
      'null pointer exception',
      '',
    ])('classifies "%s" as terminal default', (msg) => {
      const result = classifyAgentFailure(new Error(msg));
      expect(result).toEqual({
        outcome: 'failed_terminal',
        retryable: false,
        errorCode: 'AGENT_ERROR',
        errorType: 'terminal',
      });
    });
  });

  // -- input coercion -------------------------------------------------------
  describe('input coercion', () => {
    it('handles a plain string error', () => {
      const result = classifyAgentFailure('rate limit hit');
      expect(result.retryable).toBe(true);
      expect(result.errorType).toBe('transient');
    });

    it('handles a non-Error object', () => {
      const result = classifyAgentFailure({ code: 'ECONNRESET' });
      // String({code:'ECONNRESET'}) → "[object Object]", no pattern match → terminal default
      expect(result.errorType).toBe('terminal');
      expect(result.errorCode).toBe('AGENT_ERROR');
    });

    it('handles undefined', () => {
      const result = classifyAgentFailure(undefined);
      expect(result.errorType).toBe('terminal');
    });
  });

  // -- precedence -----------------------------------------------------------
  describe('classification precedence: cancelled > terminal > transient', () => {
    it('cancelled wins over terminal pattern', () => {
      // "cancelled" + "not found" → cancelled wins
      const result = classifyAgentFailure(
        new Error('request cancelled: not found'),
      );
      expect(result.errorType).toBe('cancelled');
      expect(result.retryable).toBe(false);
    });

    it('cancelled wins over transient pattern', () => {
      // "aborted" + "timeout" → cancelled wins
      const result = classifyAgentFailure(new Error('aborted due to timeout'));
      expect(result.errorType).toBe('cancelled');
      expect(result.retryable).toBe(false);
    });

    it('terminal wins over transient pattern', () => {
      // "not found" + "timeout" → terminal wins (checked before transient)
      const result = classifyAgentFailure(new Error('not found after timeout'));
      expect(result.errorType).toBe('terminal');
      expect(result.retryable).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// classifyUnexpectedJobError
// ---------------------------------------------------------------------------
describe('classifyUnexpectedJobError', () => {
  // -- cancelled (highest priority) -----------------------------------------
  describe('cancelled errors', () => {
    it.each([
      'cancelled',
      'canceled',
      'aborted',
    ])('classifies "%s" as cancelled', (msg) => {
      const result = classifyUnexpectedJobError(new Error(msg));
      expect(result).toEqual({
        retryable: false,
        errorCode: 'JOB_CANCELLED',
        errorType: 'cancelled',
        message: msg,
      });
    });
  });

  // -- transient (second priority — different from classifyAgentFailure!) ----
  describe('transient errors (retryable)', () => {
    it.each([
      'rate limit exceeded',
      'ECONNRESET',
      'socket hang up',
      'timeout waiting for response',
      'HTTP 503',
      'HTTP 429',
    ])('classifies "%s" as transient', (msg) => {
      const result = classifyUnexpectedJobError(new Error(msg));
      expect(result.retryable).toBe(true);
      expect(result.errorCode).toBe('JOB_RETRY_TRANSIENT');
      expect(result.errorType).toBe('transient');
      expect(result.message).toBe(msg);
    });
  });

  // -- terminal -------------------------------------------------------------
  describe('terminal errors', () => {
    it.each([
      'permission denied',
      'HTTP 401 Unauthorized',
      'schema validation failed',
    ])('classifies "%s" as terminal', (msg) => {
      const result = classifyUnexpectedJobError(new Error(msg));
      expect(result.retryable).toBe(false);
      expect(result.errorCode).toBe('JOB_ERROR_TERMINAL');
      expect(result.errorType).toBe('terminal');
      expect(result.message).toBe(msg);
    });
  });

  // -- unknown default ------------------------------------------------------
  describe('unknown errors', () => {
    it('defaults to unknown errorType with JOB_ERROR code', () => {
      const result = classifyUnexpectedJobError(
        new Error('something weird happened'),
      );
      expect(result).toEqual({
        retryable: false,
        errorCode: 'JOB_ERROR',
        errorType: 'unknown',
        message: 'something weird happened',
      });
    });
  });

  // -- precedence (different from classifyAgentFailure) ---------------------
  describe('classification precedence: cancelled > transient > terminal', () => {
    it('cancelled wins over transient', () => {
      const result = classifyUnexpectedJobError(
        new Error('cancelled due to timeout'),
      );
      expect(result.errorType).toBe('cancelled');
    });

    it('cancelled wins over terminal', () => {
      const result = classifyUnexpectedJobError(
        new Error('aborted: permission denied'),
      );
      expect(result.errorType).toBe('cancelled');
    });

    it('transient wins over terminal', () => {
      // "timeout" (transient) + "not found" (terminal) → transient wins here
      const result = classifyUnexpectedJobError(
        new Error('timeout: not found'),
      );
      expect(result.errorType).toBe('transient');
      expect(result.retryable).toBe(true);
    });
  });

  // -- input coercion -------------------------------------------------------
  describe('input coercion', () => {
    it('coerces string input', () => {
      const result = classifyUnexpectedJobError('timeout');
      expect(result.retryable).toBe(true);
      expect(result.message).toBe('timeout');
    });

    it('coerces undefined to "undefined"', () => {
      const result = classifyUnexpectedJobError(undefined);
      expect(result.message).toBe('undefined');
      expect(result.errorType).toBe('unknown');
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-function comparison
// ---------------------------------------------------------------------------
describe('cross-function behavior', () => {
  it('classifyAgentFailure and classifyUnexpectedJobError agree on cancelled', () => {
    const agentResult = classifyAgentFailure(new Error('cancelled'));
    const jobResult = classifyUnexpectedJobError(new Error('cancelled'));
    expect(agentResult.retryable).toBe(false);
    expect(jobResult.retryable).toBe(false);
    expect(agentResult.errorType).toBe('cancelled');
    expect(jobResult.errorType).toBe('cancelled');
  });

  it('both agree transient errors are retryable', () => {
    const msg = 'ECONNRESET';
    const agentResult = classifyAgentFailure(new Error(msg));
    const jobResult = classifyUnexpectedJobError(new Error(msg));
    expect(agentResult.retryable).toBe(true);
    expect(jobResult.retryable).toBe(true);
  });

  it('different precedence: agent checks terminal before transient, job checks transient before terminal', () => {
    // "not found" matches terminal, "timeout" matches transient
    const msg = 'not found after timeout';
    const agentResult = classifyAgentFailure(new Error(msg));
    const jobResult = classifyUnexpectedJobError(new Error(msg));
    // Agent: terminal > transient → terminal wins
    expect(agentResult.errorType).toBe('terminal');
    expect(agentResult.retryable).toBe(false);
    // Job: transient > terminal → transient wins
    expect(jobResult.errorType).toBe('transient');
    expect(jobResult.retryable).toBe(true);
  });
});
