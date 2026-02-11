import { describe, expect, it } from 'bun:test';
import { AGENT_IDS, AGENTS, type AgentId } from './agents';
import { buildCapabilitiesView } from './capabilities';
import { SCOPE_IDS, SCOPES, type ScopeId } from './scopes';
import { TRIGGER_IDS, TRIGGERS, type TriggerId } from './triggers';

function expectAgentId(value: AgentId): AgentId {
  return value;
}

function expectTriggerId(value: TriggerId): TriggerId {
  return value;
}

function expectScopeId(value: ScopeId): ScopeId {
  return value;
}

describe('canonical registries', () => {
  it('exposes all built-in agent ids', () => {
    expect(AGENT_IDS).toEqual(['janitor', 'hunter', 'inspector', 'scribe']);
    expect(Object.keys(AGENTS)).toEqual([...AGENT_IDS]);
  });

  it('exposes all built-in trigger ids', () => {
    expect(TRIGGER_IDS).toEqual(['commit', 'pr', 'manual']);
    expect(Object.keys(TRIGGERS)).toEqual([...TRIGGER_IDS]);
  });

  it('exposes all built-in scope ids', () => {
    expect(SCOPE_IDS).toEqual(['commit-diff', 'workspace-diff', 'repo', 'pr']);
    expect(Object.keys(SCOPES)).toEqual([...SCOPE_IDS]);
  });

  it('derives typed ids from registries', () => {
    expect(expectAgentId('janitor')).toBe('janitor');
    expect(expectTriggerId('manual')).toBe('manual');
    expect(expectScopeId('workspace-diff')).toBe('workspace-diff');
  });
});

describe('agent capability matrix', () => {
  it('matches locked default trigger and manual scope semantics', () => {
    expect(AGENTS.janitor.defaults.autoTriggers).toEqual(['commit']);
    expect(AGENTS.hunter.defaults.autoTriggers).toEqual(['pr']);
    expect(AGENTS.inspector.defaults.autoTriggers).toEqual([]);
    expect(AGENTS.scribe.defaults.autoTriggers).toEqual([]);

    expect(AGENTS.janitor.capabilities.manualScopes).toEqual([
      'workspace-diff',
      'repo',
    ]);
    expect(AGENTS.hunter.capabilities.manualScopes).toEqual([
      'workspace-diff',
      'repo',
      'pr',
    ]);
    expect(AGENTS.inspector.capabilities.manualScopes).toEqual(['repo']);
    expect(AGENTS.scribe.capabilities.manualScopes).toEqual(['repo']);
  });

  it('hard-gates auto triggers by capability sets', () => {
    expect(AGENTS.janitor.capabilities.autoTriggers).toEqual(['commit', 'pr']);
    expect(AGENTS.hunter.capabilities.autoTriggers).toEqual(['commit', 'pr']);
    expect(AGENTS.inspector.capabilities.autoTriggers).toEqual([
      'commit',
      'pr',
    ]);
    expect(AGENTS.scribe.capabilities.autoTriggers).toEqual(['commit', 'pr']);
  });
});

describe('capabilities view', () => {
  it('builds a capability payload from canonical registries', () => {
    const capabilities = buildCapabilitiesView();

    expect(capabilities.agents).toHaveLength(4);
    expect(capabilities.triggers).toHaveLength(3);
    expect(capabilities.scopes).toHaveLength(4);

    const hunter = capabilities.agents.find((agent) => agent.id === 'hunter');
    expect(hunter?.manualScopes).toEqual(['workspace-diff', 'repo', 'pr']);

    const manual = capabilities.triggers.find(
      (trigger) => trigger.id === 'manual',
    );
    expect(manual?.defaultScope).toBeNull();
    expect(manual?.allowedScopes).toEqual([
      'commit-diff',
      'workspace-diff',
      'repo',
      'pr',
    ]);

    const prScope = capabilities.scopes.find((scope) => scope.id === 'pr');
    expect(prScope?.inputs).toEqual([
      {
        key: 'prNumber',
        flag: '--pr <number>',
        description: 'PR number to review',
        required: true,
      },
    ]);
  });
});
