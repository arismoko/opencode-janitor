import { AGENTS, type AgentId } from '../agents';
import { SCOPES, type ScopeId } from '../scopes';
import { TRIGGERS, type TriggerId } from '../triggers';

export type AgentCapabilityView = {
  id: AgentId;
  label: string;
  description: string;
  manualScopes: ScopeId[];
  autoTriggers: TriggerId[];
  cli: {
    command: string;
    alias?: string;
    description: string;
  };
};

export type ScopeCapabilityView = {
  id: ScopeId;
  label: string;
  description: string;
  inputs: Array<{
    key: string;
    flag: string;
    description: string;
    required: boolean;
  }>;
};

export type TriggerCapabilityView = {
  id: TriggerId;
  label: string;
  description: string;
  mode: 'auto' | 'manual' | 'both';
  allowedScopes: ScopeId[];
  defaultScope: ScopeId | null;
};

export type CapabilitiesView = {
  agents: AgentCapabilityView[];
  scopes: ScopeCapabilityView[];
  triggers: TriggerCapabilityView[];
};

export function buildCapabilitiesView(): CapabilitiesView {
  const agents = Object.values(AGENTS).map((agent) => ({
    id: agent.id,
    label: agent.label,
    description: agent.description,
    manualScopes: [...agent.capabilities.manualScopes],
    autoTriggers: [...agent.capabilities.autoTriggers],
    cli: {
      command: agent.cli.command,
      alias: agent.cli.alias,
      description: agent.cli.description,
    },
  }));

  const scopes = Object.values(SCOPES).map((scope) => ({
    id: scope.id,
    label: scope.label,
    description: scope.description,
    inputs: (scope.cliOptions ?? []).map((option) => ({
      key: option.key,
      flag: option.flag,
      description: option.description,
      required: option.required === true,
    })),
  }));

  const triggers = Object.values(TRIGGERS).map((trigger) => ({
    id: trigger.id,
    label: trigger.label,
    description: trigger.description,
    mode: trigger.mode,
    allowedScopes: [...trigger.allowedScopes],
    defaultScope: trigger.defaultScope,
  }));

  return { agents, scopes, triggers };
}
