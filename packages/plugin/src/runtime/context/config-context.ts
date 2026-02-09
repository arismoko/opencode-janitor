/**
 * Configuration and feature-flag context slice.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../../config/schema';
import type { AgentTriggers } from '../bootstrap';

export interface ConfigContext {
  ctx: PluginInput;
  config: JanitorConfig;
  agentTriggers: AgentTriggers;
  anyCommitReviews: boolean;
  anyPrReviews: boolean;
}
