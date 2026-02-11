import { errorResponse, json } from '../http/response';
import {
  getBodyField,
  parseJsonBody,
  parseQueryInt,
  requireString,
} from '../http/validation';
import type { DashboardApi, Route } from '../socket-types';

function handleDashboardSnapshot(url: URL, dashboard: DashboardApi): Response {
  const eventsLimit = parseQueryInt(url, 'eventsLimit', 80, 1);
  const reportsLimit = parseQueryInt(url, 'reportsLimit', 40, 1);
  const boundedEventsLimit = Math.min(eventsLimit, 500);
  const boundedReportsLimit = Math.min(reportsLimit, 200);
  return json(
    200,
    dashboard.getDashboardSnapshot(boundedEventsLimit, boundedReportsLimit),
  );
}

function handleDashboardReport(url: URL, dashboard: DashboardApi): Response {
  const agentRunId = url.searchParams.get('agentRunId');
  if (!agentRunId || agentRunId.trim().length === 0) {
    return errorResponse(
      400,
      'INVALID_AGENT_RUN_ID',
      '`agentRunId` query param is required',
    );
  }

  const findingsLimit = parseQueryInt(url, 'findingsLimit', 120, 1);
  const boundedFindingsLimit = Math.min(findingsLimit, 500);
  const detail = dashboard.getDashboardReportDetail(
    agentRunId,
    boundedFindingsLimit,
  );
  if (!detail) {
    return errorResponse(404, 'NOT_FOUND', 'Report not found');
  }
  return json(200, detail);
}

async function handleDeleteReport(request: Request, dashboard: DashboardApi) {
  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(400, 'INVALID_BODY', message);
  }

  let agentRunId: string;
  try {
    agentRunId = requireString(getBodyField(body, 'agentRunId'), 'agentRunId');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(400, 'INVALID_AGENT_RUN_ID', message);
  }

  try {
    const response = dashboard.onDeleteReport(agentRunId);
    return json(200, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(400, 'DELETE_FAILED', message);
  }
}

export function createDashboardRoutes(dashboard: DashboardApi): Route[] {
  return [
    {
      method: 'GET',
      path: '/v1/dashboard/snapshot',
      handler: (_request, url) => handleDashboardSnapshot(url, dashboard),
    },
    {
      method: 'GET',
      path: '/v1/dashboard/report',
      handler: (_request, url) => handleDashboardReport(url, dashboard),
    },
    {
      method: 'DELETE',
      path: '/v1/dashboard/report',
      handler: (request) => handleDeleteReport(request, dashboard),
    },
  ];
}
