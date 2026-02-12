import { AGENTS, type AgentId, type TriggerId } from '@opencode-janitor/shared';
import type { CliConfig } from '../config/schema';

export interface AgentEligibilityResult {
  eligible: boolean;
  reason?: string;
}

interface ManualEligibilityPayload {
  agent?: string;
}

export function canAgentRunForTrigger(
  config: CliConfig,
  agentId: AgentId,
  triggerId: TriggerId,
): AgentEligibilityResult {
  const agentConfig = config.agents[agentId];
  if (!agentConfig.enabled) {
    return { eligible: false, reason: 'agent_disabled' };
  }

  if (triggerId === 'manual') {
    return { eligible: true };
  }

  if (!agentConfig.autoTriggers.includes(triggerId)) {
    return { eligible: false, reason: 'trigger_not_enabled_in_config' };
  }

  if (!AGENTS[agentId].capabilities.autoTriggers.includes(triggerId)) {
    return { eligible: false, reason: 'trigger_not_supported_by_agent' };
  }

  return { eligible: true };
}

export function canAgentPlanForEvent(
  config: CliConfig,
  agentId: AgentId,
  triggerId: TriggerId,
  manualPayload: ManualEligibilityPayload = {},
): AgentEligibilityResult {
  const base = canAgentRunForTrigger(config, agentId, triggerId);
  if (!base.eligible) {
    return base;
  }

  if (
    triggerId === 'manual' &&
    manualPayload.agent &&
    manualPayload.agent !== agentId
  ) {
    return { eligible: false, reason: 'manual_target_mismatch' };
  }

  return { eligible: true };
}
