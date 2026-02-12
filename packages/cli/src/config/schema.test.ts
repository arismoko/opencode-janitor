import { describe, expect, it } from 'bun:test';
import { AGENT_IDS, AGENTS, TRIGGER_IDS } from '@opencode-janitor/shared';
import { defaultLockPath, defaultPidPath, defaultSocketPath } from './paths';
import {
  AgentsSection,
  CliConfigSchema,
  DaemonSection,
  DetectorSection,
  defaultCliConfig,
  OpencodeSection,
  SchedulerSection,
  ScopeSection,
  TriggersSection,
} from './schema';

const commitDefaultAgent = AGENT_IDS.find(
  (agentId) => AGENTS[agentId].defaults.autoTriggers[0] === 'commit',
);
const prDefaultAgent = AGENT_IDS.find(
  (agentId) => AGENTS[agentId].defaults.autoTriggers[0] === 'pr',
);
const repoOnlyAgent = AGENT_IDS.find((agentId) =>
  AGENTS[agentId].capabilities.manualScopes.every((scope) => scope === 'repo'),
);

if (!commitDefaultAgent || !prDefaultAgent || !repoOnlyAgent) {
  throw new Error('Expected canonical capability profiles.');
}

describe('default values from empty input', () => {
  it('CliConfigSchema.parse({}) produces a fully populated config', () => {
    const cfg = CliConfigSchema.parse({});
    expect(cfg.daemon).toBeDefined();
    expect(cfg.scheduler).toBeDefined();
    expect(cfg.detector).toBeDefined();
    expect(cfg.opencode).toBeDefined();
    expect(cfg.scope).toBeDefined();
    expect(cfg.agents).toBeDefined();
    expect(cfg.triggers).toBeDefined();
  });

  it('DaemonSection defaults', () => {
    const d = DaemonSection.parse({});
    expect(d.socketPath).toBe(defaultSocketPath());
    expect(d.pidFile).toBe(defaultPidPath());
    expect(d.lockFile).toBe(defaultLockPath());
    expect(d.logLevel).toBe('info');
    expect(d.webHost).toBe('127.0.0.1');
    expect(d.webPort).toBe(7700);
  });

  it('SchedulerSection defaults', () => {
    const s = SchedulerSection.parse({});
    expect(s.globalConcurrency).toBe(2);
    expect(s.perRepoConcurrency).toBe(1);
    expect(s.agentParallelism).toBe(2);
    expect(s.maxAttempts).toBe(3);
    expect(s.retryBackoffMs).toBe(3000);
  });

  it('DetectorSection defaults', () => {
    const det = DetectorSection.parse({});
    expect(det.minPollSec).toBe(15);
    expect(det.maxPollSec).toBe(60);
    expect(det.probeConcurrency).toBe(4);
    expect(det.prTtlSec).toBe(300);
    expect(det.pollJitterPct).toBe(10);
  });

  it('OpencodeSection defaults', () => {
    const o = OpencodeSection.parse({});
    expect(o.defaultModelId).toBe('');
    expect(o.hubSessionTitle).toBe('janitor-hub');
    expect(o.serverHost).toBe('127.0.0.1');
    expect(o.serverPort).toBe(4096);
    expect(o.serverStartTimeoutMs).toBe(8000);
  });

  it('ScopeSection defaults', () => {
    const s = ScopeSection.parse({});
    expect(s.include).toEqual([
      '**/*.{ts,tsx,js,jsx,py,go,rs,java,rb,swift,kt}',
    ]);
    expect(s.exclude).toContain('**/node_modules/**');
  });
});

describe('registry-derived agent and trigger config', () => {
  it('builds all agents from canonical registry', () => {
    const parsed = AgentsSection.parse({});

    expect(Object.keys(parsed).sort()).toEqual([...AGENT_IDS].sort());
    for (const agentId of AGENT_IDS) {
      expect(parsed[agentId].enabled).toBe(true);
      expect(parsed[agentId].autoTriggers).toEqual([
        ...AGENTS[agentId].defaults.autoTriggers,
      ]);
      expect(parsed[agentId].maxFindings).toBe(
        AGENTS[agentId].defaults.maxFindings ?? 10,
      );
      expect(parsed[agentId].manualDefaultScope).toBe(
        AGENTS[agentId].defaults.manualScope,
      );
    }
  });

  it('builds all triggers from canonical registry', () => {
    const parsed = TriggersSection.parse({});

    expect(Object.keys(parsed).sort()).toEqual([...TRIGGER_IDS].sort());
    expect(parsed.commit.enabled).toBe(true);
    expect(parsed.pr.enabled).toBe(true);
    expect(parsed.pr.postComment).toBe(true);
    expect(parsed.manual.enabled).toBe(true);
  });

  it('parses explicit PR postComment=false', () => {
    const parsed = TriggersSection.parse({
      pr: {
        postComment: false,
      },
    });
    expect(parsed.pr.postComment).toBe(false);
  });

  it('preserves registry auto-trigger defaults under partial overrides', () => {
    const parsed = AgentsSection.parse({
      [commitDefaultAgent]: {
        modelId: 'openai/gpt-5.3-codex',
        variant: 'xhigh',
      },
      [prDefaultAgent]: { modelId: 'openai/gpt-5.3-codex' },
    });

    expect(parsed[commitDefaultAgent].autoTriggers).toEqual([
      ...AGENTS[commitDefaultAgent].defaults.autoTriggers,
    ]);
    expect(parsed[prDefaultAgent].autoTriggers).toEqual([
      ...AGENTS[prDefaultAgent].defaults.autoTriggers,
    ]);
    expect(parsed[commitDefaultAgent].variant).toBe('xhigh');
  });
});

describe('hard capability gate validation', () => {
  it('rejects autoTriggers outside agent capability', () => {
    const result = AgentsSection.safeParse({
      [commitDefaultAgent]: { autoTriggers: ['manual'] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects manualDefaultScope outside agent capability', () => {
    const result = AgentsSection.safeParse({
      [repoOnlyAgent]: { manualDefaultScope: 'workspace-diff' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid capability-constrained overrides', () => {
    const parsed = AgentsSection.parse({
      [prDefaultAgent]: {
        autoTriggers: ['commit', 'pr'],
        manualDefaultScope: 'pr',
      },
    });

    expect(parsed[prDefaultAgent].autoTriggers).toEqual(['commit', 'pr']);
    expect(parsed[prDefaultAgent].manualDefaultScope).toBe('pr');
  });

  it('parses global and per-agent permission extensions', () => {
    const parsed = CliConfigSchema.parse({
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
        [prDefaultAgent]: {
          permissionExtensions: {
            'context7_*': 'allow',
            'gh_grep_*': {
              '*': 'ask',
              'search*': 'allow',
            },
          },
        },
      },
    });

    expect(parsed.opencode.permissionExtensions).toEqual({
      'context7_*': 'ask',
      bash: {
        '*': 'ask',
        'git status*': 'allow',
      },
    });
    expect(parsed.agents[prDefaultAgent].permissionExtensions).toEqual({
      'context7_*': 'allow',
      'gh_grep_*': {
        '*': 'ask',
        'search*': 'allow',
      },
    });
  });

  it('rejects invalid permission extension actions', () => {
    const globalResult = CliConfigSchema.safeParse({
      opencode: {
        permissionExtensions: {
          'context7_*': 'maybe',
        },
      },
    });
    expect(globalResult.success).toBe(false);

    const agentResult = CliConfigSchema.safeParse({
      agents: {
        [prDefaultAgent]: {
          permissionExtensions: {
            bash: {
              '*': 'yes',
            },
          },
        },
      },
    });
    expect(agentResult.success).toBe(false);
  });
});

describe('strict unknown key rejection', () => {
  it('rejects unknown agent ids', () => {
    const result = AgentsSection.safeParse({
      ghost: { enabled: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown trigger ids', () => {
    const result = TriggersSection.safeParse({
      hourly: { enabled: true },
    });
    expect(result.success).toBe(false);
  });
});

describe('existing numeric guards still apply', () => {
  it('webPort rejects out-of-range values', () => {
    expect(DaemonSection.safeParse({ webPort: 0 }).success).toBe(false);
    expect(DaemonSection.safeParse({ webPort: 65536 }).success).toBe(false);
  });

  it('maxFindings rejects out-of-range values', () => {
    expect(
      AgentsSection.safeParse({ [commitDefaultAgent]: { maxFindings: 0 } })
        .success,
    ).toBe(false);
    expect(
      AgentsSection.safeParse({ [commitDefaultAgent]: { maxFindings: 51 } })
        .success,
    ).toBe(false);
  });

  it('pollJitterPct rejects values above 50', () => {
    expect(DetectorSection.safeParse({ pollJitterPct: 51 }).success).toBe(
      false,
    );
  });
});

describe('defaultCliConfig', () => {
  it('round-trips through CliConfigSchema', () => {
    const reparsed = CliConfigSchema.parse(defaultCliConfig);
    expect(reparsed).toEqual(defaultCliConfig);
  });

  it('matches fresh parse of empty input', () => {
    expect(defaultCliConfig).toEqual(CliConfigSchema.parse({}));
  });
});
