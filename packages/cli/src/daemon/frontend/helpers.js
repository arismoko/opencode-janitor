import { MAX_EVENTS } from './constants.js';

export function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString();
}

export function fmtAgo(ms) {
  if (!ms) return '-';
  const deltaMs = Date.now() - ms;
  if (deltaMs < 60000) return `${Math.floor(deltaMs / 1000)}s ago`;
  if (deltaMs < 3600000) return `${Math.floor(deltaMs / 60000)}m ago`;
  if (deltaMs < 86400000) return `${Math.floor(deltaMs / 3600000)}h ago`;
  return `${Math.floor(deltaMs / 86400000)}d ago`;
}

export function mergeEvents(previous, incoming) {
  if (!incoming || incoming.length === 0) return previous;
  const byId = new Map(previous.map((event) => [event.eventId, event]));
  for (const event of incoming) {
    byId.set(event.eventId, event);
  }

  const merged = [...byId.values()].sort((a, b) => a.eventId - b.eventId);
  return merged.length > MAX_EVENTS
    ? merged.slice(merged.length - MAX_EVENTS)
    : merged;
}

export function severityDots(report) {
  const dots = [];
  for (let index = 0; index < report.p0Count; index += 1) dots.push('P0');
  for (let index = 0; index < report.p1Count; index += 1) dots.push('P1');
  for (let index = 0; index < report.p2Count; index += 1) dots.push('P2');
  for (let index = 0; index < report.p3Count; index += 1) dots.push('P3');
  return dots.slice(0, 18);
}
