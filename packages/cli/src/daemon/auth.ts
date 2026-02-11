/**
 * Auth token for the daemon web server.
 *
 * A random bearer token is generated at daemon startup and written to a
 * user-private file. The web server requires it on mutating endpoints
 * (POST, DELETE) to prevent cross-origin attacks from browser tabs.
 *
 * The Unix socket does NOT require auth — it is already permission-restricted
 * (0600) in $XDG_RUNTIME_DIR.
 */

import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureParentDirs, runtimeDir } from '../config/paths';

const AUTH_TOKEN_FILENAME = 'auth-token';

/** Path to the auth token file in the runtime directory. */
export function authTokenPath(): string {
  return join(runtimeDir(), AUTH_TOKEN_FILENAME);
}

/** Generate a cryptographically random auth token. */
export function generateAuthToken(): string {
  return randomBytes(32).toString('hex');
}

/** Write the auth token to disk with restrictive permissions. */
export function writeAuthToken(token: string): void {
  const path = authTokenPath();
  ensureParentDirs(path);
  writeFileSync(path, token, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Read the auth token from disk, or null if unavailable. */
export function readAuthToken(): string | null {
  try {
    return readFileSync(authTokenPath(), 'utf8').trim() || null;
  } catch {
    return null;
  }
}
