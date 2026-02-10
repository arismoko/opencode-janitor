/**
 * Pure helper functions shared across dashboard components.
 * No side-effects, no transport calls.
 */

import { basename } from 'node:path';
import type {
  DashboardAgentState,
  DashboardFinding,
  DashboardReportSummary,
  DashboardRepoState,
  EventJournalEntry,
  StreamState,
} from './types';

/* ------------------------------------------------------------------ */
/*  Text utilities                                                      */
/* ------------------------------------------------------------------ */

export function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/* ------------------------------------------------------------------ */
/*  Time formatting                                                     */
/* ------------------------------------------------------------------ */

export function shortClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function shortDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function relativeTime(ts: number, now: number): string {
  const delta = now - ts;
  if (delta < 0) return 'just now';
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

export function etaLabel(targetTs: number, nowTs: number): string {
  const delta = targetTs - nowTs;
  if (delta <= 0) return 'due';
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `in ${sec}s`;
  const min = Math.floor(sec / 60);
  return `in ${min}m`;
}

/* ------------------------------------------------------------------ */
/*  Color / tone helpers                                                */
/* ------------------------------------------------------------------ */

export function streamStateColor(
  state: StreamState,
): 'cyan' | 'green' | 'yellow' | 'red' {
  switch (state) {
    case 'live':
      return 'green';
    case 'stale':
      return 'yellow';
    case 'error':
      return 'red';
    default:
      return 'cyan';
  }
}

export function levelColor(
  level: 'debug' | 'info' | 'warn' | 'error',
): 'gray' | 'blue' | 'yellow' | 'red' {
  switch (level) {
    case 'debug':
      return 'gray';
    case 'info':
      return 'blue';
    case 'warn':
      return 'yellow';
    case 'error':
      return 'red';
  }
}

export function severityColor(
  severity: DashboardFinding['severity'],
): 'red' | 'yellow' | 'blue' | 'gray' {
  switch (severity) {
    case 'P0':
      return 'red';
    case 'P1':
      return 'yellow';
    case 'P2':
      return 'blue';
    case 'P3':
      return 'gray';
  }
}

export function statusIcon(status: DashboardReportSummary['status']): {
  icon: string;
  color: 'cyan' | 'green' | 'red' | 'yellow' | 'gray';
} {
  switch (status) {
    case 'running':
      return { icon: '*', color: 'cyan' };
    case 'succeeded':
      return { icon: '+', color: 'green' };
    case 'failed':
      return { icon: 'x', color: 'red' };
    case 'queued':
      return { icon: 'o', color: 'yellow' };
    case 'skipped':
      return { icon: '-', color: 'gray' };
  }
}

export function severityBar(report: DashboardReportSummary): string {
  const parts: string[] = [];
  if (report.p0Count > 0) parts.push(`P0:${report.p0Count}`);
  if (report.p1Count > 0) parts.push(`P1:${report.p1Count}`);
  if (report.p2Count > 0) parts.push(`P2:${report.p2Count}`);
  if (report.p3Count > 0) parts.push(`P3:${report.p3Count}`);
  return parts.length > 0 ? parts.join(' ') : '-';
}

/* ------------------------------------------------------------------ */
/*  Repo / agent tone                                                   */
/* ------------------------------------------------------------------ */

export function repoStateTone(repo: DashboardRepoState): {
  dot: string;
  color: 'gray' | 'yellow' | 'cyan' | 'green';
  label: string;
} {
  if (!repo.enabled) return { dot: 'o', color: 'gray', label: 'disabled' };
  if (repo.paused) return { dot: '~', color: 'yellow', label: 'paused' };
  if (repo.runningJobs > 0)
    return { dot: '*', color: 'cyan', label: 'running' };
  if (repo.queuedJobs > 0)
    return { dot: '@', color: 'yellow', label: 'queued' };
  if (repo.idleStreak > 0) return { dot: '.', color: 'gray', label: 'idle' };
  return { dot: '*', color: 'green', label: 'watching' };
}

export function agentStateTone(agent: DashboardAgentState): {
  dot: string;
  color: 'gray' | 'yellow' | 'cyan' | 'green' | 'red';
  label: string;
} {
  if (agent.failedRuns > 0) return { dot: '#', color: 'red', label: 'fault' };
  if (agent.runningRuns > 0)
    return { dot: '*', color: 'cyan', label: 'active' };
  if (agent.queuedRuns > 0)
    return { dot: '@', color: 'yellow', label: 'queued' };
  if (agent.succeededRuns > 0)
    return { dot: '*', color: 'green', label: 'ready' };
  return { dot: 'o', color: 'gray', label: 'idle' };
}

/* ------------------------------------------------------------------ */
/*  Path helpers                                                        */
/* ------------------------------------------------------------------ */

export function shortRepoName(path: string): string {
  const name = basename(path);
  return name.length > 0 ? name : path;
}

/* ------------------------------------------------------------------ */
/*  Event helpers                                                       */
/* ------------------------------------------------------------------ */

/** Numeric rank for event levels used in filtering and sorting. */
export function eventLevelRank(level: EventJournalEntry['level']): number {
  switch (level) {
    case 'debug':
      return 0;
    case 'info':
      return 1;
    case 'warn':
      return 2;
    case 'error':
      return 3;
  }
}

/**
 * Merge incoming events into an existing buffer, de-duplicating by seq,
 * keeping the buffer capped at `maxSize` (most recent entries).
 */
export function mergeEvents(
  previous: EventJournalEntry[],
  incoming: EventJournalEntry[],
  maxSize: number,
): EventJournalEntry[] {
  if (incoming.length === 0) return previous;
  const bySeq = new Map<number, EventJournalEntry>();
  for (const row of previous) bySeq.set(row.eventId, row);
  for (const row of incoming) bySeq.set(row.eventId, row);
  const merged = [...bySeq.values()].sort((a, b) => a.eventId - b.eventId);
  if (merged.length <= maxSize) return merged;
  return merged.slice(merged.length - maxSize);
}

/** Extract a human-readable message from an unknown thrown value. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Promise-based delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/*  Session transcript                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build a flowing transcript string from session events.
 *
 * - `session.delta` events: append the raw `delta` text preserving newlines.
 * - `session.status` / `session.idle` / `session.error`: insert a marker line.
 *
 * Returns the concatenated transcript string.
 */
export function buildTranscript(events: EventJournalEntry[]): string {
  const parts: string[] = [];

  for (const ev of events) {
    if (ev.topic === 'session.delta') {
      const delta =
        typeof ev.payload.delta === 'string' ? ev.payload.delta : ev.message;
      parts.push(delta);
    } else if (ev.topic.startsWith('session.')) {
      const label = ev.topic.replace('session.', '').toUpperCase();
      const msg = ev.message || label;
      parts.push(`\n--- ${label}: ${msg} ---\n`);
    }
  }

  return parts.join('');
}

/**
 * Split a string into visual lines respecting a max width.
 * Uses word-boundary wrapping (greedy). Each output line is at most `width` chars.
 */
export function wrapLines(text: string, width: number): string[] {
  if (width <= 0) return [];
  const result: string[] = [];

  for (const rawLine of text.split('\n')) {
    if (rawLine.length === 0) {
      result.push('');
      continue;
    }
    let remaining = rawLine;
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(' ', width);
      if (breakAt <= 0) breakAt = width;
      result.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).replace(/^ /, '');
    }
    result.push(remaining);
  }

  return result;
}
