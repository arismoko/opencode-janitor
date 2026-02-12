import type { AgentName } from '@opencode-janitor/shared';
import type { EnqueueReviewRequest } from '../../ipc/protocol';
import { errorResponse, json } from '../http/response';
import {
  getBodyField,
  parseJsonBody,
  requireAgentName,
  requireRecord,
  requireScopeId,
  requireString,
  ValidationError,
} from '../http/validation';
import type { ReviewApi, Route } from '../socket-types';

async function handleStopReview(request: Request, review: ReviewApi) {
  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, error.code, error.message);
    }
    return errorResponse(
      400,
      'INVALID_BODY',
      'Request body must be valid JSON',
    );
  }

  let reviewRunId: string;
  try {
    reviewRunId = requireString(
      getBodyField(body, 'reviewRunId'),
      'reviewRunId',
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, error.code, error.message, {
        ...(error.field ? { field: error.field } : {}),
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(400, 'INVALID_BODY', message);
  }

  try {
    const response = await review.onStopReview({ reviewRunId });
    return json(200, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(400, 'STOP_FAILED', message);
  }
}

async function handleResumeReview(request: Request, review: ReviewApi) {
  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, error.code, error.message);
    }
    return errorResponse(
      400,
      'INVALID_BODY',
      'Request body must be valid JSON',
    );
  }

  let reviewRunId: string;
  try {
    reviewRunId = requireString(
      getBodyField(body, 'reviewRunId'),
      'reviewRunId',
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, error.code, error.message, {
        ...(error.field ? { field: error.field } : {}),
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(400, 'INVALID_BODY', message);
  }

  try {
    const response = await review.onResumeReview({ reviewRunId });
    if (!response.resumed && response.errorCode === 'NOT_RESUMABLE') {
      return errorResponse(
        409,
        'NOT_RESUMABLE',
        'Run is not resumable in-place',
        {
          reviewRunId,
        },
      );
    }
    return json(200, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(400, 'RESUME_FAILED', message);
  }
}

async function handleEnqueueReview(request: Request, review: ReviewApi) {
  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, error.code, error.message);
    }
    return errorResponse(
      400,
      'INVALID_BODY',
      'Request body must be valid JSON',
    );
  }

  let repoOrId: string;
  let agent: AgentName;
  let scope: EnqueueReviewRequest['scope'];
  let input: EnqueueReviewRequest['input'];
  let note: EnqueueReviewRequest['note'];
  let focusPath: EnqueueReviewRequest['focusPath'];

  try {
    repoOrId = requireString(getBodyField(body, 'repoOrId'), 'repoOrId');
    agent = requireAgentName(getBodyField(body, 'agent'));

    const scopeRaw = getBodyField(body, 'scope');
    if (scopeRaw !== undefined) {
      scope = requireScopeId(scopeRaw);
    }

    const inputRaw = getBodyField(body, 'input');
    if (inputRaw !== undefined) {
      input = requireRecord(inputRaw, 'input');
    }

    const noteRaw = getBodyField(body, 'note');
    if (noteRaw !== undefined) {
      note = requireString(noteRaw, 'note');
    }

    const focusPathRaw = getBodyField(body, 'focusPath');
    if (focusPathRaw !== undefined) {
      focusPath = requireString(focusPathRaw, 'focusPath');
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, error.code, error.message, {
        ...(error.field ? { field: error.field } : {}),
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(400, 'INVALID_BODY', message);
  }

  try {
    const requestBody: EnqueueReviewRequest = {
      repoOrId,
      agent,
      ...(scope ? { scope } : {}),
      ...(input ? { input } : {}),
      ...(note ? { note } : {}),
      ...(focusPath ? { focusPath } : {}),
    };
    const response = await review.onEnqueueReview(requestBody);
    return json(200, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(400, 'ENQUEUE_FAILED', message);
  }
}

export function createReviewRoutes(review: ReviewApi): Route[] {
  return [
    {
      method: 'POST',
      path: '/v1/reviews/enqueue',
      handler: (request) => handleEnqueueReview(request, review),
    },
    {
      method: 'POST',
      path: '/v1/reviews/stop',
      handler: (request) => handleStopReview(request, review),
    },
    {
      method: 'POST',
      path: '/v1/reviews/resume',
      handler: (request) => handleResumeReview(request, review),
    },
  ];
}
