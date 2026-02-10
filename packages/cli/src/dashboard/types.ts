/**
 * Dashboard-local type aliases.
 *
 * Re-exports from the IPC protocol so that dashboard components never need
 * to reach into ../ipc/* directly.
 */

export type {
  DashboardAgentState,
  DashboardDaemonState,
  DashboardFinding,
  DashboardReportDetailResponse,
  DashboardReportSummary,
  DashboardRepoState,
  DashboardSnapshotResponse,
  ErrorResponse,
  EventJournalEntry,
  EventsResponse,
} from '../ipc/protocol';

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export type StreamState = 'connecting' | 'live' | 'stale' | 'error';
export type StreamScope = 'all' | 'repo' | 'report';
export type ViewMode = 'reports' | 'repos' | 'activity';
export type FocusPane = 'list' | 'detail';

export type DetailMode = 'findings' | 'session';

// ---------------------------------------------------------------------------
// Detail cache
// ---------------------------------------------------------------------------

export interface CachedReportDetail {
  data: import('../ipc/protocol').DashboardReportDetailResponse;
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Keymap
// ---------------------------------------------------------------------------

export interface KeyBinding {
  readonly key: string;
  readonly label: string;
  readonly action: string;
}

export interface ScopedKeymap {
  readonly scope: string;
  readonly bindings: readonly KeyBinding[];
}
