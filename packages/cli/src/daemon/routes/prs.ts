import { errorResponse, json } from '../http/response';
import {
  getBodyField,
  parseJsonBody,
  parseQueryInt,
  requirePositiveInt,
  requireString,
  ValidationError,
} from '../http/validation';
import type { PrApi, Route } from '../socket-types';

const BUCKETS = new Set([
  'all-open',
  'review-requested',
  'assigned',
  'created-by-me',
  'mentioned',
]);

function requireBucket(
  value: string | null,
):
  | 'all-open'
  | 'review-requested'
  | 'assigned'
  | 'created-by-me'
  | 'mentioned'
  | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!BUCKETS.has(normalized)) {
    throw new ValidationError(
      'INVALID_BODY',
      '`bucket` must be one of all-open, review-requested, assigned, created-by-me, mentioned',
      'bucket',
    );
  }
  return normalized as
    | 'all-open'
    | 'review-requested'
    | 'assigned'
    | 'created-by-me'
    | 'mentioned';
}

function parseQueryPrNumber(url: URL): number {
  const raw = url.searchParams.get('prNumber');
  if (!raw || raw.trim().length === 0) {
    throw new ValidationError(
      'INVALID_PR',
      '`prNumber` query param is required',
      'prNumber',
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(
      'INVALID_PR',
      '`prNumber` must be a positive integer',
      'prNumber',
    );
  }
  return parsed;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(
      'INVALID_BODY',
      `\`${field}\` must be an array`,
      field,
    );
  }
  const list = value.map((item) => requireString(item, field));
  if (list.length === 0) {
    throw new ValidationError(
      'INVALID_BODY',
      `\`${field}\` must include at least one item`,
      field,
    );
  }
  return [...new Set(list)];
}

function validationErrorToResponse(error: ValidationError): Response {
  return errorResponse(400, error.code, error.message, {
    ...(error.field ? { field: error.field } : {}),
  });
}

function unknownErrorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function handleListPrs(url: URL, pr: PrApi): Promise<Response> {
  try {
    const repoOrId = requireString(
      url.searchParams.get('repoOrId'),
      'repoOrId',
    );
    const bucket = requireBucket(url.searchParams.get('bucket'));
    const queryRaw = url.searchParams.get('query');
    const query =
      queryRaw && queryRaw.trim().length > 0 ? queryRaw.trim() : undefined;
    const limit = Math.min(parseQueryInt(url, 'limit', 30, 1), 200);

    const response = await pr.listPrs({
      repoOrId,
      ...(bucket ? { bucket } : {}),
      ...(query ? { query } : {}),
      limit,
    });
    return json(200, response);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorToResponse(error);
    }
    return errorResponse(400, 'PRS_LIST_FAILED', unknownErrorToMessage(error));
  }
}

async function handlePrDetail(url: URL, pr: PrApi): Promise<Response> {
  try {
    const repoOrId = requireString(
      url.searchParams.get('repoOrId'),
      'repoOrId',
    );
    const prNumber = parseQueryPrNumber(url);

    const response = await pr.getPrDetail({ repoOrId, prNumber });
    return json(200, response);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorToResponse(error);
    }
    return errorResponse(
      400,
      'PRS_DETAIL_FAILED',
      unknownErrorToMessage(error),
    );
  }
}

async function handleMergePr(request: Request, pr: PrApi): Promise<Response> {
  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorToResponse(error);
    }
    return errorResponse(
      400,
      'INVALID_BODY',
      'Request body must be valid JSON',
    );
  }

  try {
    const repoOrId = requireString(getBodyField(body, 'repoOrId'), 'repoOrId');
    const prNumber = requirePositiveInt(
      getBodyField(body, 'prNumber'),
      'prNumber',
    );
    const methodRaw = getBodyField(body, 'method');
    const method =
      methodRaw === undefined
        ? undefined
        : requireString(methodRaw, 'method').toLowerCase();

    if (
      method !== undefined &&
      method !== 'merge' &&
      method !== 'squash' &&
      method !== 'rebase'
    ) {
      throw new ValidationError(
        'INVALID_BODY',
        '`method` must be one of merge, squash, rebase',
        'method',
      );
    }

    const response = await pr.mergePr({
      repoOrId,
      prNumber,
      ...(method ? { method } : {}),
    });
    return json(200, response);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorToResponse(error);
    }
    return errorResponse(400, 'PRS_MERGE_FAILED', unknownErrorToMessage(error));
  }
}

async function handleCommentPr(request: Request, pr: PrApi): Promise<Response> {
  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorToResponse(error);
    }
    return errorResponse(
      400,
      'INVALID_BODY',
      'Request body must be valid JSON',
    );
  }

  try {
    const repoOrId = requireString(getBodyField(body, 'repoOrId'), 'repoOrId');
    const prNumber = requirePositiveInt(
      getBodyField(body, 'prNumber'),
      'prNumber',
    );
    const commentBody = requireString(getBodyField(body, 'body'), 'body');

    const response = await pr.commentPr({
      repoOrId,
      prNumber,
      body: commentBody,
    });
    return json(200, response);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorToResponse(error);
    }
    return errorResponse(
      400,
      'PRS_COMMENT_FAILED',
      unknownErrorToMessage(error),
    );
  }
}

async function handleRequestReviewers(
  request: Request,
  pr: PrApi,
): Promise<Response> {
  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorToResponse(error);
    }
    return errorResponse(
      400,
      'INVALID_BODY',
      'Request body must be valid JSON',
    );
  }

  try {
    const repoOrId = requireString(getBodyField(body, 'repoOrId'), 'repoOrId');
    const prNumber = requirePositiveInt(
      getBodyField(body, 'prNumber'),
      'prNumber',
    );
    const reviewers = parseStringArray(
      getBodyField(body, 'reviewers'),
      'reviewers',
    );

    const response = await pr.requestReviewers({
      repoOrId,
      prNumber,
      reviewers,
    });
    return json(200, response);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorToResponse(error);
    }
    return errorResponse(
      400,
      'PRS_REQUEST_REVIEWERS_FAILED',
      unknownErrorToMessage(error),
    );
  }
}

async function handleReplyComment(
  request: Request,
  pr: PrApi,
): Promise<Response> {
  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorToResponse(error);
    }
    return errorResponse(
      400,
      'INVALID_BODY',
      'Request body must be valid JSON',
    );
  }

  try {
    const repoOrId = requireString(getBodyField(body, 'repoOrId'), 'repoOrId');
    const prNumber = requirePositiveInt(
      getBodyField(body, 'prNumber'),
      'prNumber',
    );
    const commentId = requirePositiveInt(
      getBodyField(body, 'commentId'),
      'commentId',
    );
    const replyBody = requireString(getBodyField(body, 'body'), 'body');

    const response = await pr.replyReviewComment({
      repoOrId,
      prNumber,
      commentId,
      body: replyBody,
    });
    return json(200, response);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorToResponse(error);
    }
    return errorResponse(
      400,
      'PRS_REPLY_COMMENT_FAILED',
      unknownErrorToMessage(error),
    );
  }
}

export function createPrRoutes(pr: PrApi): Route[] {
  return [
    {
      method: 'GET',
      path: '/v1/prs/list',
      handler: (_request, url) => handleListPrs(url, pr),
    },
    {
      method: 'GET',
      path: '/v1/prs/detail',
      handler: (_request, url) => handlePrDetail(url, pr),
    },
    {
      method: 'POST',
      path: '/v1/prs/merge',
      handler: (request) => handleMergePr(request, pr),
    },
    {
      method: 'POST',
      path: '/v1/prs/comment',
      handler: (request) => handleCommentPr(request, pr),
    },
    {
      method: 'POST',
      path: '/v1/prs/request-reviewers',
      handler: (request) => handleRequestReviewers(request, pr),
    },
    {
      method: 'POST',
      path: '/v1/prs/reply-comment',
      handler: (request) => handleReplyComment(request, pr),
    },
  ];
}
