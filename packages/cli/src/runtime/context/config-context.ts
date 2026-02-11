import type { CliConfig } from '../../config/schema';

/** Static configuration and process metadata. */
export interface ConfigContext {
  config: CliConfig;
  dbPath: string;
  startedAt: number;
}
