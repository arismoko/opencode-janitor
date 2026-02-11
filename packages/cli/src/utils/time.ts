/**
 * Unix millisecond time helpers.
 */

/** Current time in Unix milliseconds. */
export function nowMs(): number {
  return Date.now();
}

/** Format a Unix-ms timestamp as ISO-8601 local string. */
export function formatTs(ms: number): string {
  return new Date(ms).toISOString();
}
