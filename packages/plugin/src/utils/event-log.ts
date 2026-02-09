import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Append a single SSE event as a JSONL line to the session's event log.
 *
 * Each line is a self-contained JSON object with the original event
 * plus a `_ts` timestamp. The inspect script post-processes these
 * into human-readable output.
 */
export function appendEvent(
  stateDir: string,
  sessionId: string,
  event: { type: string; properties?: Record<string, unknown> },
): void {
  const line = JSON.stringify({ _ts: Date.now(), ...event });
  appendFileSync(join(stateDir, `${sessionId}.jsonl`), line + '\n');
}
