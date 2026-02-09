/**
 * Lightweight logger for the janitor plugin.
 *
 * All output goes to a temp file — never to stderr/stdout, which breaks
 * OpenCode's TUI rendering. This matches the idiomatic pattern used by
 * oh-my-opencode-slim and other OpenCode plugins.
 *
 * Log file: /tmp/opencode-janitor.log (capped at ~5 MB, single rotation).
 */

import {
  appendFileSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG_FILE = join(tmpdir(), 'opencode-janitor.log');
const LOG_FILE_PREV = `${LOG_FILE}.1`;
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB
const PREFIX = '[janitor]';

/**
 * Extract a human-readable message from an unknown thrown value.
 * Centralizes the `err instanceof Error ? err.message : String(err)` pattern.
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Tracks writes so we don't stat the file on every single append. */
let writesSinceCheck = 0;
const CHECK_EVERY = 50;

function rotateIfNeeded(): void {
  try {
    const { size } = statSync(LOG_FILE);
    if (size >= MAX_LOG_BYTES) {
      try {
        // Remove old backup first to avoid rename failure on some platforms
        try {
          unlinkSync(LOG_FILE_PREV);
        } catch {
          // No previous backup — fine
        }
        renameSync(LOG_FILE, LOG_FILE_PREV);
      } catch {
        // Rename failed — truncate in place as fallback
        try {
          truncateSync(LOG_FILE, 0);
        } catch {
          // Nothing left to try — next append creates fresh
        }
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
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  append(`${PREFIX} ${message}${suffix}`);
}

export function warn(message: string, data?: Record<string, unknown>): void {
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  append(`${PREFIX} WARN: ${message}${suffix}`);
}

export function error(message: string, err?: unknown): void {
  const errMsg = err != null ? getErrorMessage(err) : '';
  append(`${PREFIX} ERROR: ${message}${errMsg ? ` — ${errMsg}` : ''}`);
}
