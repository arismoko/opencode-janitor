import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JanitorConfigSchema, type JanitorConfig } from './schema';
import { log } from '../utils/logger';

const CONFIG_FILENAME = 'janitor.json';

/**
 * Load janitor configuration from the project root.
 * Falls back to defaults if no config file is found.
 */
export function loadConfig(directory: string): JanitorConfig {
  const configPath = join(directory, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    log('[config] no janitor.json found, using defaults');
    return JanitorConfigSchema.parse({});
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const json = JSON.parse(raw);
    const config = JanitorConfigSchema.parse(json);
    log('[config] loaded janitor.json');
    return config;
  } catch (err) {
    log(`[config] failed to parse janitor.json: ${err}`);
    return JanitorConfigSchema.parse({});
  }
}
