/**
 * Load and validate CLI JSON config.
 */
import { existsSync, readFileSync } from 'node:fs';
import { defaultConfigPath } from './paths';
import { type CliConfig, CliConfigSchema, defaultCliConfig } from './schema';

/**
 * Load config from a JSON file. Falls back to defaults if the file
 * does not exist. Throws descriptive errors on parse/validation failure.
 */
export function loadConfig(filePath?: string): CliConfig {
  const path = filePath ?? defaultConfigPath();

  if (!existsSync(path)) {
    return defaultCliConfig;
  }

  const raw = readFileSync(path, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse JSON config at ${path}: ${msg}`);
  }

  const result = CliConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map(
        (i: { path: PropertyKey[]; message: string }) =>
          `  - ${i.path.map(String).join('.')}: ${i.message}`,
      )
      .join('\n');
    throw new Error(`Invalid config at ${path}:\n${issues}`);
  }

  return result.data;
}
