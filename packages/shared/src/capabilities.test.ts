import { describe, expect, it } from 'bun:test';
import { AGENT_IDS, AGENTS, type AgentId } from './agents';
import { buildCapabilitiesView } from './capabilities';
import { SCOPE_IDS, SCOPES, type ScopeId } from './scopes';
import { TRIGGER_IDS, TRIGGERS, type TriggerId } from './triggers';

const commitDefaultAgent = AGENT_IDS.find(
  (agentId) => AGENTS[agentId].defaults.autoTriggers[0] === 'commit',
);
const prDefaultAgent = AGENT_IDS.find(
  (agentId) => AGENTS[agentId].defaults.autoTriggers[0] === 'pr',
);
const enrichedAgent = AGENT_IDS.find(
  (agentId) =>
    (AGENTS[agentId].findingEnrichments?.definitions.length ?? 0) > 0,
);

if (!commitDefaultAgent || !prDefaultAgent || !enrichedAgent) {
  throw new Error('Expected canonical capability fixtures.');
}

const enrichedRenderer: string = (() => {
  const renderer =
    AGENTS[enrichedAgent].findingEnrichments?.definitions[0]?.renderer;
  if (!renderer) {
    throw new Error('Expected at least one enriched renderer definition.');
  }
  return renderer;
})();

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
    expect(AGENT_IDS).toHaveLength(4);
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
    expect(expectAgentId(commitDefaultAgent)).toBe(commitDefaultAgent);
    expect(expectTriggerId('manual')).toBe('manual');
    expect(expectScopeId('workspace-diff')).toBe('workspace-diff');
  });
});

describe('agent capability matrix', () => {
  it('matches locked default trigger and manual scope semantics', () => {
    expect(AGENTS[commitDefaultAgent].defaults.autoTriggers).toEqual([
      'commit',
    ]);
    expect(AGENTS[prDefaultAgent].defaults.autoTriggers).toEqual(['pr']);

    expect(AGENTS[commitDefaultAgent].capabilities.manualScopes).toEqual([
      'workspace-diff',
      'repo',
    ]);
    expect(AGENTS[prDefaultAgent].capabilities.manualScopes).toEqual([
      'workspace-diff',
      'repo',
      'pr',
    ]);
    for (const agentId of AGENT_IDS) {
      expect(AGENTS[agentId].capabilities.manualScopes.length).toBeGreaterThan(
        0,
      );
    }
  });

  it('hard-gates auto triggers by capability sets', () => {
    for (const agentId of AGENT_IDS) {
      expect(AGENTS[agentId].capabilities.autoTriggers).toEqual([
        'commit',
        'pr',
      ]);
    }
  });
});

describe('capabilities view', () => {
  it('builds a capability payload from canonical registries', () => {
    const capabilities = buildCapabilitiesView();

    expect(capabilities.agents).toHaveLength(4);
    expect(capabilities.triggers).toHaveLength(3);
    expect(capabilities.scopes).toHaveLength(4);

    const prAgent = capabilities.agents.find(
      (agent) => agent.id === prDefaultAgent,
    );
    expect(prAgent?.manualScopes).toContain('pr');

    const enriched = capabilities.agents.find(
      (agent) => agent.id === enrichedAgent,
    );
    expect(enriched?.findingEnrichments).toEqual([
      {
        kind: 'architecture',
        title: 'Architecture',
        renderer: enrichedRenderer,
        collapsedByDefault: true,
      },
    ]);

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
