import { describe, expect, it } from 'bun:test';
import { AGENT_IDS, AGENTS } from '@opencode-janitor/shared';
import { CliConfigSchema, defaultCliConfig } from '../config/schema';
import {
  buildSystemPrompt,
  createAgentConfigMap,
  createAgentDefinition,
  REVIEW_AGENT_PERMISSIONS,
  REVIEW_AGENT_TOOLS,
} from './agent-factory';

// ---------------------------------------------------------------------------
// Permission envelope
// ---------------------------------------------------------------------------

describe('REVIEW_AGENT_PERMISSIONS', () => {
  it('denies edit, bash, webfetch, doom_loop, and external_directory', () => {
    expect(REVIEW_AGENT_PERMISSIONS).toEqual({
      edit: 'deny',
      bash: 'deny',
      webfetch: 'deny',
      doom_loop: 'deny',
      external_directory: 'deny',
    });
  });

  it('has no "allow" or "ask" values', () => {
    for (const [key, value] of Object.entries(REVIEW_AGENT_PERMISSIONS)) {
      expect(value).toBe('deny');
    }
  });
});

// ---------------------------------------------------------------------------
// Allowed tools
// ---------------------------------------------------------------------------

describe('REVIEW_AGENT_TOOLS', () => {
  it('allows only glob, grep, list, read, and lsp', () => {
    expect(REVIEW_AGENT_TOOLS).toEqual({
      glob: true,
      grep: true,
      list: true,
      read: true,
      lsp: true,
    });
  });

  it('does not allow dangerous tools', () => {
    const dangerous = ['edit', 'bash', 'webfetch', 'write', 'exec'];
    for (const tool of dangerous) {
      expect(REVIEW_AGENT_TOOLS).not.toHaveProperty(tool);
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
      expect(def.config.maxSteps).toBe(2);
      expect(def.config.permission).toEqual(REVIEW_AGENT_PERMISSIONS);
      expect(def.config.tools).toEqual(REVIEW_AGENT_TOOLS);
    }
  });

  it('includes the system prompt from the canonical definition', () => {
    const definition = AGENTS.janitor;
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
        janitor: { modelId: 'anthropic/claude-sonnet-4-20250514' },
      },
    });

    const def = createAgentDefinition(AGENTS.janitor, config);

    expect(def.config.model).toBe('anthropic/claude-sonnet-4-20250514');
  });

  it('applies default model ID when no per-agent override exists', () => {
    const config = CliConfigSchema.parse({
      opencode: { defaultModelId: 'openai/gpt-4o' },
    });

    const def = createAgentDefinition(AGENTS.hunter, config);

    expect(def.config.model).toBe('openai/gpt-4o');
  });

  it('omits model field when neither per-agent nor default model is set', () => {
    const def = createAgentDefinition(AGENTS.hunter, defaultCliConfig);

    // defaultCliConfig has defaultModelId = '' which is falsy
    expect(def.config.model).toBeUndefined();
  });

  it('per-agent modelId takes precedence over default', () => {
    const config = CliConfigSchema.parse({
      opencode: { defaultModelId: 'openai/gpt-4o' },
      agents: {
        scribe: { modelId: 'anthropic/claude-sonnet-4-20250514' },
      },
    });

    const def = createAgentDefinition(AGENTS.scribe, config);

    expect(def.config.model).toBe('anthropic/claude-sonnet-4-20250514');
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('includes role, domains, and output schema sections', () => {
    const definition = AGENTS.hunter;
    const prompt = buildSystemPrompt(definition);

    expect(prompt).toContain('You are The Hunter');
    expect(prompt).toContain('# DOMAINS');
    expect(prompt).toContain('BUG');
    expect(prompt).toContain('CORRECTNESS');
    expect(prompt).toContain('# OUTPUT SCHEMA');
    expect(prompt).toContain('"type"');
  });

  it('includes rules section when definition has rules', () => {
    const definition = AGENTS.janitor;
    const prompt = buildSystemPrompt(definition);

    expect(prompt).toContain('# RULES');
    expect(definition.rules).toBeDefined();
    expect(prompt).toContain(definition.rules!);
  });

  it('omits rules section when definition has no rules', () => {
    const definition = {
      ...AGENTS.janitor,
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

  it('enforces denied permissions on every agent in the map', () => {
    const map = createAgentConfigMap(defaultCliConfig);

    for (const id of AGENT_IDS) {
      expect(map[id].config.permission).toEqual(REVIEW_AGENT_PERMISSIONS);
      expect(map[id].config.tools).toEqual(REVIEW_AGENT_TOOLS);
    }
  });

  it('all agents run as subagent mode', () => {
    const map = createAgentConfigMap(defaultCliConfig);

    for (const id of AGENT_IDS) {
      expect(map[id].config.mode).toBe('subagent');
    }
  });
});
