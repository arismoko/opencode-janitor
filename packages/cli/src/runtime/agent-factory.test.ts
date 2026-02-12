import { describe, expect, it } from 'bun:test';
import {
  AGENT_IDS,
  AGENTS,
  DEFAULT_REVIEW_AGENT_PERMISSIONS,
} from '@opencode-janitor/shared';
import { CliConfigSchema, defaultCliConfig } from '../config/schema';
import {
  buildSystemPrompt,
  createAgentConfigMap,
  createAgentDefinition,
} from './agent-factory';

const cleanupAgentId = AGENT_IDS.find((agentId) =>
  AGENTS[agentId].domains.includes('YAGNI'),
);
const bugAgentId = AGENT_IDS.find((agentId) =>
  AGENTS[agentId].domains.includes('BUG'),
);
const docsAgentId = AGENT_IDS.find((agentId) =>
  AGENTS[agentId].domains.includes('DRIFT'),
);

if (!cleanupAgentId || !bugAgentId || !docsAgentId) {
  throw new Error('Expected canonical domain-mapped agents.');
}

// ---------------------------------------------------------------------------
// Agent runtime policy
// ---------------------------------------------------------------------------

describe('agent definition runtime policy', () => {
  it('each agent declares wildcard deny with tool allow overrides', () => {
    for (const id of AGENT_IDS) {
      expect(AGENTS[id].runtime.permission).toEqual(
        DEFAULT_REVIEW_AGENT_PERMISSIONS,
      );
      expect(AGENTS[id].runtime.permission['*']).toBe('deny');
      expect(AGENTS[id].runtime.permission.glob).toBe('allow');
      expect(AGENTS[id].runtime.permission.grep).toBe('allow');
      expect(AGENTS[id].runtime.permission.list).toBe('allow');
      expect(AGENTS[id].runtime.permission.read).toBe('allow');
      expect(AGENTS[id].runtime.permission.lsp).toBe('allow');
      expect(AGENTS[id].runtime.maxSteps).toBeGreaterThan(0);
    }
  });

  it('runtime permissions keep dangerous capabilities denied by default', () => {
    const dangerous = ['edit', 'bash', 'webfetch', 'write', 'exec'];
    for (const permissionKey of dangerous) {
      for (const id of AGENT_IDS) {
        expect(
          AGENTS[id].runtime.permission[permissionKey] ??
            AGENTS[id].runtime.permission['*'],
        ).toBe('deny');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// createAgentDefinition
// ---------------------------------------------------------------------------

describe('createAgentDefinition', () => {
  it('produces a valid definition for each canonical agent', () => {
    for (const id of AGENT_IDS) {
      const definition = AGENTS[id];
      const def = createAgentDefinition(definition, defaultCliConfig);

      expect(def.name).toBe(id);
      expect(def.description).toBe(definition.description);
      expect(def.config.mode).toBe('subagent');
      expect(def.config.maxSteps).toBe(definition.runtime.maxSteps);
      expect(def.config.permission).toEqual(definition.runtime.permission);
    }
  });

  it('includes the system prompt from the canonical definition', () => {
    const definition = AGENTS[cleanupAgentId];
    const def = createAgentDefinition(definition, defaultCliConfig);

    // System prompt must contain role text and domains
    expect(def.config.prompt).toContain('You are The Janitor');
    expect(def.config.prompt).toContain('YAGNI');
    expect(def.config.prompt).toContain('DRY');
    expect(def.config.prompt).toContain('DEAD');
    expect(def.config.prompt).toContain('OUTPUT SCHEMA');
  });

  it('applies per-agent model override from config', () => {
    const config = CliConfigSchema.parse({
      agents: {
        [cleanupAgentId]: { modelId: 'anthropic/claude-sonnet-4-20250514' },
      },
    });

    const def = createAgentDefinition(AGENTS[cleanupAgentId], config);

    expect(def.config.model).toBe('anthropic/claude-sonnet-4-20250514');
  });

  it('applies default model ID when no per-agent override exists', () => {
    const config = CliConfigSchema.parse({
      opencode: { defaultModelId: 'openai/gpt-4o' },
    });

    const def = createAgentDefinition(AGENTS[bugAgentId], config);

    expect(def.config.model).toBe('openai/gpt-4o');
  });

  it('omits model field when neither per-agent nor default model is set', () => {
    const def = createAgentDefinition(AGENTS[bugAgentId], defaultCliConfig);

    // defaultCliConfig has defaultModelId = '' which is falsy
    expect(def.config.model).toBeUndefined();
  });

  it('per-agent modelId takes precedence over default', () => {
    const config = CliConfigSchema.parse({
      opencode: { defaultModelId: 'openai/gpt-4o' },
      agents: {
        [docsAgentId]: { modelId: 'anthropic/claude-sonnet-4-20250514' },
      },
    });

    const def = createAgentDefinition(AGENTS[docsAgentId], config);

    expect(def.config.model).toBe('anthropic/claude-sonnet-4-20250514');
  });

  it('includes per-agent variant in emitted runtime config', () => {
    const config = CliConfigSchema.parse({
      agents: {
        [cleanupAgentId]: { variant: 'xhigh' },
      },
    });

    const def = createAgentDefinition(AGENTS[cleanupAgentId], config);

    expect(def.config.variant).toBe('xhigh');
  });

  it('omits variant when configured as blank/whitespace', () => {
    const config = CliConfigSchema.parse({
      agents: {
        [cleanupAgentId]: { variant: '   ' },
      },
    });

    const def = createAgentDefinition(AGENTS[cleanupAgentId], config);

    expect(def.config.variant).toBeUndefined();
  });

  it('merges base permission with global and per-agent extensions', () => {
    const config = CliConfigSchema.parse({
      opencode: {
        permissionExtensions: {
          'context7_*': 'ask',
          bash: {
            '*': 'ask',
            'git status*': 'allow',
          },
        },
      },
      agents: {
        [docsAgentId]: {
          permissionExtensions: {
            'context7_*': 'allow',
            bash: {
              'git *': 'allow',
              'git push *': 'deny',
            },
          },
        },
      },
    });

    const def = createAgentDefinition(AGENTS[docsAgentId], config);

    const permission = def.config.permission as Record<string, unknown>;
    expect(permission['context7_*']).toBe('allow');
    expect(permission.bash).toEqual({
      '*': 'ask',
      'git status*': 'allow',
      'git *': 'allow',
      'git push *': 'deny',
    });
    expect(permission.read).toBe(AGENTS[docsAgentId].runtime.permission.read);
    expect(permission.list).toBe(AGENTS[docsAgentId].runtime.permission.list);
    expect(permission.glob).toBe(AGENTS[docsAgentId].runtime.permission.glob);
    expect(permission.grep).toBe(AGENTS[docsAgentId].runtime.permission.grep);
    expect(permission.lsp).toBe(AGENTS[docsAgentId].runtime.permission.lsp);
  });

  it('keeps default emitted permissions when extensions are absent', () => {
    const def = createAgentDefinition(AGENTS[docsAgentId], defaultCliConfig);
    expect(def.config.permission).toEqual(
      AGENTS[docsAgentId].runtime.permission,
    );
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('includes role, domains, and output schema sections', () => {
    const definition = AGENTS[bugAgentId];
    const prompt = buildSystemPrompt(definition);

    expect(prompt).toContain('You are The Hunter');
    expect(prompt).toContain('# DOMAINS');
    expect(prompt).toContain('BUG');
    expect(prompt).toContain('CORRECTNESS');
    expect(prompt).toContain('# OUTPUT SCHEMA');
    expect(prompt).toContain('"type"');
  });

  it('includes rules section when definition has rules', () => {
    const definition = AGENTS[cleanupAgentId];
    const prompt = buildSystemPrompt(definition);

    expect(prompt).toContain('# RULES');
    expect(definition.rules).toBeDefined();
    expect(prompt).toContain(definition.rules!);
  });

  it('omits rules section when definition has no rules', () => {
    const definition = {
      ...AGENTS[cleanupAgentId],
      rules: undefined,
    };
    const prompt = buildSystemPrompt(definition);

    expect(prompt).not.toContain('# RULES');
  });
});

// ---------------------------------------------------------------------------
// createAgentConfigMap
// ---------------------------------------------------------------------------

describe('createAgentConfigMap', () => {
  it('produces a definition for every agent name', () => {
    const map = createAgentConfigMap(defaultCliConfig);

    for (const id of AGENT_IDS) {
      expect(map[id]).toBeDefined();
      expect(map[id].name).toBe(id);
    }
  });

  it('returns exactly the expected agent names', () => {
    const map = createAgentConfigMap(defaultCliConfig);
    const keys = Object.keys(map).sort();

    expect(keys).toEqual([...AGENT_IDS].sort());
  });

  it('uses per-agent runtime permissions', () => {
    const map = createAgentConfigMap(defaultCliConfig);

    for (const id of AGENT_IDS) {
      expect(map[id].config.permission).toEqual(AGENTS[id].runtime.permission);
    }
  });

  it('all agents run as subagent mode', () => {
    const map = createAgentConfigMap(defaultCliConfig);

    for (const id of AGENT_IDS) {
      expect(map[id].config.mode).toBe('subagent');
    }
  });
});
