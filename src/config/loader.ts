import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getErrorMessage, log, warn } from '../utils/logger';
import { type JanitorConfig, JanitorConfigSchema } from './schema';

/**
 * Resolve the XDG-compliant user config directory.
 * Respects $XDG_CONFIG_HOME, falls back to ~/.config.
 */
function getUserConfigDir(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

/**
 * Try to read and parse a JSON config file.
 * Returns the parsed object or null if the file doesn't exist or is invalid.
 */
function loadJsonFile(
  filePath: string,
  label: string,
): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const json = JSON.parse(raw);
    log(`[config] loaded ${label}: ${filePath}`);
    return json as Record<string, unknown>;
  } catch (err) {
    warn(
      `[config] failed to parse ${label} at ${filePath}: ${getErrorMessage(err)}`,
    );
    return null;
  }
}

/**
 * Deep-merge two plain objects. Arrays are replaced, not concatenated.
 * Source values override target values at each level.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];

    if (
      sv != null &&
      typeof sv === 'object' &&
      !Array.isArray(sv) &&
      tv != null &&
      typeof tv === 'object' &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(
        tv as Record<string, unknown>,
        sv as Record<string, unknown>,
      );
    } else {
      result[key] = sv;
    }
  }

  return result;
}

/**
 * Load janitor configuration from the OpenCode ecosystem paths.
 *
 * Resolution order (later overrides earlier):
 *   1. Schema defaults
 *   2. User global:   ~/.config/opencode/janitor.json  (or $XDG_CONFIG_HOME)
 *   3. Project local:  <project>/.opencode/janitor.json
 *
 * Each layer is deep-merged before Zod validation, so partial overrides work.
 */
export function loadConfig(directory: string): JanitorConfig {
  const userConfigPath = join(getUserConfigDir(), 'opencode', 'janitor.json');
  const projectConfigPath = join(directory, '.opencode', 'janitor.json');

  const userConfig = loadJsonFile(userConfigPath, 'user config');
  const projectConfig = loadJsonFile(projectConfigPath, 'project config');

  // Merge: project > user > {} (schema defaults applied by Zod parse)
  let merged: Record<string, unknown> = {};

  if (userConfig) {
    merged = deepMerge(merged, userConfig);
  }
  if (projectConfig) {
    merged = deepMerge(merged, projectConfig);
  }

  if (!userConfig && !projectConfig) {
    log('[config] no config files found, using defaults');
  }

  try {
    const parsed = JanitorConfigSchema.parse(merged);

    // Backward compatibility: legacy autoReview.onCommit controlled whether
    // janitor commit auto-reviews were enabled. If agents.janitor is not
    // explicitly configured, honor the legacy toggle by enabling/disabling
    // the janitor agent.
    const legacyAutoReview = merged.autoReview as
      | { onCommit?: unknown }
      | undefined;
    const legacyOnCommit = legacyAutoReview?.onCommit;
    const hasExplicitJanitorConfig =
      merged.agents != null &&
      typeof merged.agents === 'object' &&
      'janitor' in (merged.agents as Record<string, unknown>);

    if (!hasExplicitJanitorConfig && typeof legacyOnCommit === 'boolean') {
      parsed.agents.janitor.enabled = legacyOnCommit;
      parsed.agents.janitor.trigger = 'commit';
    }

    return parsed;
  } catch (err) {
    warn(`[config] validation failed, falling back to defaults: ${err}`);
    return JanitorConfigSchema.parse({});
  }
}
