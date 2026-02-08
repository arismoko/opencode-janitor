/**
 * Lightweight logger for the janitor plugin.
 * All messages are prefixed with [janitor] for easy filtering.
 */

const PREFIX = '[janitor]';
const DEBUG = process.env.JANITOR_DEBUG === '1';

export function log(message: string, data?: Record<string, unknown>): void {
  if (!DEBUG) return;
  if (data) {
    console.error(`${PREFIX} ${message}`, JSON.stringify(data));
  } else {
    console.error(`${PREFIX} ${message}`);
  }
}

export function warn(message: string, data?: Record<string, unknown>): void {
  if (data) {
    console.error(`${PREFIX} WARN: ${message}`, JSON.stringify(data));
  } else {
    console.error(`${PREFIX} WARN: ${message}`);
  }
}

export function error(message: string, err?: unknown): void {
  const errMsg = err instanceof Error ? err.message : String(err ?? '');
  console.error(`${PREFIX} ERROR: ${message}${errMsg ? ` — ${errMsg}` : ''}`);
}
