import type { AgentName } from '@opencode-janitor/shared';
import type { EnqueueReviewRequest } from '../../ipc/protocol';
import { errorResponse, json } from '../http/response';
import {
  getBodyField,
  parseJsonBody,
  requireAgentName,
  requirePositiveInt,
  requireString,
  ValidationError,
} from '../http/validation';
import type { ReviewApi, Route } from '../socket-types';

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
  let pr: number | undefined;

  try {
    repoOrId = requireString(getBodyField(body, 'repoOrId'), 'repoOrId');
    agent = requireAgentName(getBodyField(body, 'agent'));

    const prRaw = getBodyField(body, 'pr');
    if (prRaw !== undefined) {
      pr = requirePositiveInt(prRaw, 'pr');
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
    const requestBody: EnqueueReviewRequest = { repoOrId, agent, pr };
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
  ];
}
