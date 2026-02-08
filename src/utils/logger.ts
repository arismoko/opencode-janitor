/**
 * Lightweight logger for the janitor plugin.
 *
 * All output goes to a temp file — never to stderr/stdout, which breaks
 * OpenCode's TUI rendering. This matches the idiomatic pattern used by
 * oh-my-opencode-slim and other OpenCode plugins.
 *
 * Log file: /tmp/opencode-janitor.log (capped at ~5 MB, single rotation).
 */

import { appendFileSync, renameSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG_FILE = join(tmpdir(), 'opencode-janitor.log');
const LOG_FILE_PREV = `${LOG_FILE}.1`;
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB
const PREFIX = '[janitor]';
const DEBUG = process.env.JANITOR_DEBUG === '1';

/** Tracks writes so we don't stat the file on every single append. */
let writesSinceCheck = 0;
const CHECK_EVERY = 50;

function rotateIfNeeded(): void {
  try {
    const { size } = statSync(LOG_FILE);
    if (size >= MAX_LOG_BYTES) {
      try {
        renameSync(LOG_FILE, LOG_FILE_PREV);
      } catch {
        // Previous backup may be locked — just truncate by
        // letting the next appendFileSync create a fresh file.
      }
    }
  } catch {
    // File doesn't exist yet — nothing to rotate.
  }
}

function append(line: string): void {
  try {
    if (++writesSinceCheck >= CHECK_EVERY) {
      writesSinceCheck = 0;
      rotateIfNeeded();
    }
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
