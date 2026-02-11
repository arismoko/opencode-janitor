/**
 * XDG-compliant path resolution for config and state dirs.
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const APP_NAME = 'opencode';

function xdgConfigHome(): string {
  return process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
}

function xdgStateHome(): string {
  return process.env['XDG_STATE_HOME'] || join(homedir(), '.local', 'state');
}

/** Directory for CLI config files. */
export function configDir(): string {
  return join(xdgConfigHome(), APP_NAME);
}

/** Directory for CLI runtime state (db, pid, logs). */
export function stateDir(): string {
  return join(xdgStateHome(), APP_NAME);
}

/** Default path to the CLI JSON config file. */
export function defaultConfigPath(): string {
  return join(configDir(), 'janitor.json');
}

/** Default path to the SQLite database. */
export function defaultDbPath(): string {
  return join(stateDir(), 'daemon.db');
}

/** Ensure parent directories exist for the given file path. */
export function ensureParentDirs(filePath: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
}
