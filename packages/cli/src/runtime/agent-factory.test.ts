import { describe, expect, it } from 'bun:test';
import { AGENT_NAMES, agentProfiles } from '@opencode-janitor/shared';
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
  it('produces a valid definition for each agent profile', () => {
    for (const name of AGENT_NAMES) {
      const profile = agentProfiles.AGENT_PROFILES[name];
      const def = createAgentDefinition(profile, defaultCliConfig);

      expect(def.name).toBe(name);
      expect(def.description).toBe(profile.description);
      expect(def.config.mode).toBe('subagent');
      expect(def.config.maxSteps).toBe(2);
      expect(def.config.permission).toEqual(REVIEW_AGENT_PERMISSIONS);
      expect(def.config.tools).toEqual(REVIEW_AGENT_TOOLS);
    }
  });

  it('includes the system prompt from the profile', () => {
    const profile = agentProfiles.AGENT_PROFILES.janitor;
    const def = createAgentDefinition(profile, defaultCliConfig);

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

    const def = createAgentDefinition(
      agentProfiles.AGENT_PROFILES.janitor,
      config,
    );

    expect(def.config.model).toBe('anthropic/claude-sonnet-4-20250514');
  });

  it('applies default model ID when no per-agent override exists', () => {
    const config = CliConfigSchema.parse({
      opencode: { defaultModelId: 'openai/gpt-4o' },
    });

    const def = createAgentDefinition(
      agentProfiles.AGENT_PROFILES.hunter,
      config,
    );

    expect(def.config.model).toBe('openai/gpt-4o');
  });

  it('omits model field when neither per-agent nor default model is set', () => {
    const def = createAgentDefinition(
      agentProfiles.AGENT_PROFILES.hunter,
      defaultCliConfig,
    );

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

    const def = createAgentDefinition(
      agentProfiles.AGENT_PROFILES.scribe,
      config,
    );

    expect(def.config.model).toBe('anthropic/claude-sonnet-4-20250514');
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('includes role, domains, and output schema sections', () => {
    const profile = agentProfiles.AGENT_PROFILES.hunter;
    const prompt = buildSystemPrompt(profile);

    expect(prompt).toContain('You are The Hunter');
    expect(prompt).toContain('# DOMAINS');
    expect(prompt).toContain('BUG');
    expect(prompt).toContain('SECURITY');
    expect(prompt).toContain('CORRECTNESS');
    expect(prompt).toContain('# OUTPUT SCHEMA');
    expect(prompt).toContain('"type"');
  });

  it('includes rules section when profile has rules', () => {
    const profile = agentProfiles.AGENT_PROFILES.janitor;
    const prompt = buildSystemPrompt(profile);

    expect(prompt).toContain('# RULES');
    expect(profile.rules).toBeDefined();
    expect(prompt).toContain(profile.rules!);
  });

  it('omits rules section when profile has no rules', () => {
    // Create a synthetic profile without rules
    const profile = {
      ...agentProfiles.AGENT_PROFILES.janitor,
      rules: undefined,
    };
    const prompt = buildSystemPrompt(profile);

    expect(prompt).not.toContain('# RULES');
  });
});

// ---------------------------------------------------------------------------
// createAgentConfigMap
// ---------------------------------------------------------------------------

describe('createAgentConfigMap', () => {
  it('produces a definition for every agent name', () => {
    const map = createAgentConfigMap(defaultCliConfig);

    for (const name of AGENT_NAMES) {
      expect(map[name]).toBeDefined();
      expect(map[name].name).toBe(name);
    }
  });

  it('returns exactly the expected agent names', () => {
    const map = createAgentConfigMap(defaultCliConfig);
    const keys = Object.keys(map).sort();

    expect(keys).toEqual([...AGENT_NAMES].sort());
  });

  it('enforces denied permissions on every agent in the map', () => {
    const map = createAgentConfigMap(defaultCliConfig);

    for (const name of AGENT_NAMES) {
      expect(map[name].config.permission).toEqual(REVIEW_AGENT_PERMISSIONS);
      expect(map[name].config.tools).toEqual(REVIEW_AGENT_TOOLS);
    }
  });

  it('all agents run as subagent mode', () => {
    const map = createAgentConfigMap(defaultCliConfig);

    for (const name of AGENT_NAMES) {
      expect(map[name].config.mode).toBe('subagent');
    }
  });
});
