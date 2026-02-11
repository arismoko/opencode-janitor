/**
 * Typed client for dashboard-specific daemon endpoints.
 *
 * Delegates to the generic `requestJson` transport from ../../ipc/client.
 * Each method maps 1:1 to a daemon HTTP route.
 */

import { type JsonResponse, requestJson } from '../../ipc/client';
import type {
  DashboardReportDetailResponse,
  DashboardSnapshotResponse,
  DeleteReportResponse,
  EnqueueReviewResponse,
  ErrorResponse,
  EventsResponse,
  HealthResponse,
} from '../../ipc/protocol';

export interface DaemonClientOptions {
  readonly socketPath: string;
  readonly timeoutMs?: number;
}

/** Fetch the full dashboard snapshot from the daemon. */
export function fetchSnapshot(
  options: DaemonClientOptions,
  params?: { eventsLimit?: number; reportsLimit?: number },
): Promise<JsonResponse<DashboardSnapshotResponse | ErrorResponse>> {
  const search = new URLSearchParams();
  if (params?.eventsLimit !== undefined) {
    search.set('eventsLimit', String(params.eventsLimit));
  }
  if (params?.reportsLimit !== undefined) {
    search.set('reportsLimit', String(params.reportsLimit));
  }
  const qs = search.toString();
  const path = qs ? `/v1/dashboard/snapshot?${qs}` : '/v1/dashboard/snapshot';

  return requestJson<DashboardSnapshotResponse | ErrorResponse>({
    socketPath: options.socketPath,
    path,
    method: 'GET',
    timeoutMs: options.timeoutMs,
  });
}

/** Fetch a single report's detail (findings + raw output). */
export function fetchReportDetail(
  options: DaemonClientOptions,
  agentRunId: string,
  params?: { findingsLimit?: number },
): Promise<JsonResponse<DashboardReportDetailResponse | ErrorResponse>> {
  const search = new URLSearchParams();
  search.set('agentRunId', agentRunId);
  if (params?.findingsLimit !== undefined) {
    search.set('findingsLimit', String(params.findingsLimit));
  }

  return requestJson<DashboardReportDetailResponse | ErrorResponse>({
    socketPath: options.socketPath,
    path: `/v1/dashboard/report?${search.toString()}`,
    method: 'GET',
    timeoutMs: options.timeoutMs,
  });
}

/** Enqueue a review for a repo (by path or ID), optionally targeting a specific agent. */
export function enqueueReview(
  options: DaemonClientOptions,
  repoOrId: string,
  agent?: string,
): Promise<JsonResponse<EnqueueReviewResponse | ErrorResponse>> {
  return requestJson<EnqueueReviewResponse | ErrorResponse>({
    socketPath: options.socketPath,
    path: '/v1/reviews/enqueue',
    method: 'POST',
    body: agent ? { repoOrId, agent } : { repoOrId },
    timeoutMs: options.timeoutMs,
  });
}

/** Delete an agent run report and its findings. */
export function deleteReport(
  options: DaemonClientOptions,
  agentRunId: string,
): Promise<JsonResponse<DeleteReportResponse | ErrorResponse>> {
  return requestJson<DeleteReportResponse | ErrorResponse>({
    socketPath: options.socketPath,
    path: '/v1/dashboard/report',
    method: 'DELETE',
    body: { agentRunId },
    timeoutMs: options.timeoutMs,
  });
}

/** Fetch historical session events for an agent run from the event journal. */
export function fetchSessionEvents(
  options: DaemonClientOptions,
  agentRunId: string,
  params?: { limit?: number },
): Promise<JsonResponse<EventsResponse | ErrorResponse>> {
  const search = new URLSearchParams();
  search.set('agentRunId', agentRunId);
  search.set('afterSeq', '0');
  if (params?.limit !== undefined) {
    search.set('limit', String(params.limit));
  } else {
    search.set('limit', '500');
  }

  return requestJson<EventsResponse | ErrorResponse>({
    socketPath: options.socketPath,
    path: `/v1/events?${search.toString()}`,
    method: 'GET',
    timeoutMs: options.timeoutMs,
  });
}

export async function isDaemonRunning(
  options: DaemonClientOptions,
): Promise<boolean> {
  try {
    const response = await requestJson<HealthResponse | ErrorResponse>({
      socketPath: options.socketPath,
      path: '/v1/health',
      method: 'GET',
      timeoutMs: options.timeoutMs ?? 1000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
