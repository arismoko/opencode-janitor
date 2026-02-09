/**
 * Configuration and feature-flag context slice.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../../config/schema';

export interface ConfigContext {
  ctx: PluginInput;
  config: JanitorConfig;
  janitorCommitEnabled: boolean;
  janitorPrEnabled: boolean;
  hunterCommitEnabled: boolean;
  hunterPrEnabled: boolean;
  anyCommitReviews: boolean;
  anyPrReviews: boolean;
}
