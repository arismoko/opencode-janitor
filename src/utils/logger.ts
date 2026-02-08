/**
 * Lightweight logger for the janitor plugin.
 *
 * All output goes to a temp file — never to stderr/stdout, which breaks
 * OpenCode's TUI rendering. This matches the idiomatic pattern used by
 * oh-my-opencode-slim and other OpenCode plugins.
 */

import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG_FILE = join(tmpdir(), 'opencode-janitor.log');
const PREFIX = '[janitor]';
const DEBUG = process.env.JANITOR_DEBUG === '1';

function append(line: string): void {
  try {
    const ts = new Date().toISOString();
    appendFileSync(LOG_FILE, `[${ts}] ${line}\n`);
  } catch {
    // Silently ignore logging errors
  }
}

export function log(message: string, data?: Record<string, unknown>): void {
  if (!DEBUG) return;
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  append(`${PREFIX} ${message}${suffix}`);
}

export function warn(message: string, data?: Record<string, unknown>): void {
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  append(`${PREFIX} WARN: ${message}${suffix}`);
}

export function error(message: string, err?: unknown): void {
  const errMsg = err instanceof Error ? err.message : String(err ?? '');
  append(`${PREFIX} ERROR: ${message}${errMsg ? ` — ${errMsg}` : ''}`);
}
