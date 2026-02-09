import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the XDG-compliant state directory for a project.
 *
 * Layout: $XDG_STATE_HOME/opencode-janitor/<project-hash>/
 *
 * The project hash is a short SHA-256 of the workspace directory path,
 * giving each project an isolated namespace without leaking full paths
 * into directory names.
 */
export function resolveStateDir(workspaceDir: string): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  const hash = createHash('sha256')
    .update(workspaceDir)
    .digest('hex')
    .slice(0, 12);
  return join(base, 'opencode-janitor', hash);
}

/** Ensure the project state directory exists. */
export function ensureStateDir(stateDir: string): void {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
}
