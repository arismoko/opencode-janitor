/**
 * Atomic config writer — JSON format.
 */
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultConfigPath, ensureParentDirs } from './paths';
import { type CliConfig, defaultCliConfig } from './schema';

// ---------------------------------------------------------------------------
// Atomic write helper
// ---------------------------------------------------------------------------

function atomicWrite(filePath: string, content: string): void {
  ensureParentDirs(filePath);
  const tmpPath = join(dirname(filePath), `.tmp-${Date.now()}`);
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Write config object to JSON file atomically. */
export function writeConfig(config: CliConfig, filePath?: string): void {
  const path = filePath ?? defaultConfigPath();
  atomicWrite(path, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Ensure the config file exists, creating it with defaults if missing.
 * Returns the path to the config file.
 */
export function ensureConfigFile(filePath?: string): string {
  const path = filePath ?? defaultConfigPath();
  if (!existsSync(path)) {
    writeConfig(defaultCliConfig, path);
  }
  return path;
}
