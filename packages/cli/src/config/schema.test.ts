import { describe, expect, it } from 'bun:test';
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
} from './schema';

// ---------------------------------------------------------------------------
// 1. Default values — parsing empty/minimal input produces expected defaults
// ---------------------------------------------------------------------------

describe('default values from empty input', () => {
  it('CliConfigSchema.parse({}) produces a fully populated config', () => {
    const cfg = CliConfigSchema.parse({});
    expect(cfg).toBeDefined();

    // spot-check each top-level section exists
    expect(cfg.daemon).toBeDefined();
    expect(cfg.scheduler).toBeDefined();
    expect(cfg.detector).toBeDefined();
    expect(cfg.opencode).toBeDefined();
    expect(cfg.scope).toBeDefined();
    expect(cfg.agents).toBeDefined();
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
    expect(s.exclude).toContain('**/dist/**');
  });
});

// ---------------------------------------------------------------------------
// 2. Min/max guards — numeric fields are bounded
// ---------------------------------------------------------------------------

describe('min/max guards', () => {
  it('webPort rejects 0', () => {
    const r = DaemonSection.safeParse({ webPort: 0 });
    expect(r.success).toBe(false);
  });

  it('webPort rejects 65536', () => {
    const r = DaemonSection.safeParse({ webPort: 65536 });
    expect(r.success).toBe(false);
  });

  it('webPort accepts 1 and 65535', () => {
    expect(DaemonSection.parse({ webPort: 1 }).webPort).toBe(1);
    expect(DaemonSection.parse({ webPort: 65535 }).webPort).toBe(65535);
  });

  it('minPollSec rejects 0', () => {
    const r = DetectorSection.safeParse({ minPollSec: 0 });
    expect(r.success).toBe(false);
  });

  it('maxPollSec rejects 0', () => {
    const r = DetectorSection.safeParse({ maxPollSec: 0 });
    expect(r.success).toBe(false);
  });

  it('pollJitterPct rejects values above 50', () => {
    const r = DetectorSection.safeParse({ pollJitterPct: 51 });
    expect(r.success).toBe(false);
  });

  it('pollJitterPct accepts 0 and 50', () => {
    expect(DetectorSection.parse({ pollJitterPct: 0 }).pollJitterPct).toBe(0);
    expect(DetectorSection.parse({ pollJitterPct: 50 }).pollJitterPct).toBe(50);
  });

  it('globalConcurrency rejects 0', () => {
    const r = SchedulerSection.safeParse({ globalConcurrency: 0 });
    expect(r.success).toBe(false);
  });

  it('retryBackoffMs rejects < 100', () => {
    const r = SchedulerSection.safeParse({ retryBackoffMs: 99 });
    expect(r.success).toBe(false);
  });

  it('maxFindings rejects 0 and 51', () => {
    const agents = AgentsSection.parse({});
    // maxFindings is bounded 1..50 in AgentRuntimeConfig
    const low = AgentsSection.safeParse({
      janitor: { maxFindings: 0 },
    });
    expect(low.success).toBe(false);

    const high = AgentsSection.safeParse({
      janitor: { maxFindings: 51 },
    });
    expect(high.success).toBe(false);
  });

  it('maxFindings accepts 1 and 50', () => {
    const a1 = AgentsSection.parse({ janitor: { maxFindings: 1 } });
    expect(a1.janitor.maxFindings).toBe(1);

    const a50 = AgentsSection.parse({ janitor: { maxFindings: 50 } });
    expect(a50.janitor.maxFindings).toBe(50);
  });

  it('serverStartTimeoutMs rejects < 1000', () => {
    const r = OpencodeSection.safeParse({ serverStartTimeoutMs: 999 });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Per-agent default triggers
// ---------------------------------------------------------------------------

describe('per-agent default triggers', () => {
  it('janitor defaults to commit', () => {
    const a = AgentsSection.parse({});
    expect(a.janitor.trigger).toBe('commit');
  });

  it('hunter defaults to pr', () => {
    const a = AgentsSection.parse({});
    expect(a.hunter.trigger).toBe('pr');
  });

  it('inspector defaults to manual', () => {
    const a = AgentsSection.parse({});
    expect(a.inspector.trigger).toBe('manual');
  });

  it('scribe defaults to manual', () => {
    const a = AgentsSection.parse({});
    expect(a.scribe.trigger).toBe('manual');
  });

  it('all agents default to enabled: true', () => {
    const a = AgentsSection.parse({});
    expect(a.janitor.enabled).toBe(true);
    expect(a.hunter.enabled).toBe(true);
    expect(a.inspector.enabled).toBe(true);
    expect(a.scribe.enabled).toBe(true);
  });

  it('all agents default maxFindings to 10', () => {
    const a = AgentsSection.parse({});
    expect(a.janitor.maxFindings).toBe(10);
    expect(a.hunter.maxFindings).toBe(10);
    expect(a.inspector.maxFindings).toBe(10);
    expect(a.scribe.maxFindings).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 4. defaultCliConfig remains parseable and produces valid output
// ---------------------------------------------------------------------------

describe('defaultCliConfig', () => {
  it('is a valid CliConfig object', () => {
    // Re-parse to confirm it round-trips
    const reparsed = CliConfigSchema.parse(defaultCliConfig);
    expect(reparsed).toEqual(defaultCliConfig);
  });

  it('matches a fresh parse of empty input', () => {
    const fresh = CliConfigSchema.parse({});
    expect(defaultCliConfig).toEqual(fresh);
  });
});

// ---------------------------------------------------------------------------
// 5. Invalid values — enum fields reject unknown values
// ---------------------------------------------------------------------------

describe('invalid enum values', () => {
  it('logLevel rejects unknown value', () => {
    const r = DaemonSection.safeParse({ logLevel: 'trace' });
    expect(r.success).toBe(false);
  });

  it('logLevel accepts all valid values', () => {
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      expect(DaemonSection.parse({ logLevel: level }).logLevel).toBe(level);
    }
  });

  it('trigger rejects unknown value', () => {
    const r = AgentsSection.safeParse({
      janitor: { trigger: 'hourly' },
    });
    expect(r.success).toBe(false);
  });

  it('trigger accepts all valid TriggerMode values', () => {
    for (const mode of ['commit', 'pr', 'both', 'manual', 'never'] as const) {
      const a = AgentsSection.parse({ janitor: { trigger: mode } });
      expect(a.janitor.trigger).toBe(mode);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Partial overrides — providing only some fields uses defaults for rest
// ---------------------------------------------------------------------------

describe('partial overrides', () => {
  it('overriding one daemon field keeps other defaults', () => {
    const d = DaemonSection.parse({ logLevel: 'debug' });
    expect(d.logLevel).toBe('debug');
    expect(d.webPort).toBe(7700);
    expect(d.socketPath).toBe(defaultSocketPath());
  });

  it('overriding one agent keeps other agents at defaults', () => {
    const a = AgentsSection.parse({
      janitor: { trigger: 'never', enabled: false },
    });
    expect(a.janitor.trigger).toBe('never');
    expect(a.janitor.enabled).toBe(false);
    // other agents untouched
    expect(a.hunter.trigger).toBe('pr');
    expect(a.inspector.trigger).toBe('manual');
    expect(a.scribe.trigger).toBe('manual');
  });

  it('overriding one field in an agent keeps other agent defaults', () => {
    const a = AgentsSection.parse({
      hunter: { maxFindings: 5 },
    });
    expect(a.hunter.maxFindings).toBe(5);
    expect(a.hunter.trigger).toBe('pr');
    expect(a.hunter.enabled).toBe(true);
  });

  it('top-level partial override keeps other sections', () => {
    const cfg = CliConfigSchema.parse({
      daemon: { logLevel: 'error' },
    });
    expect(cfg.daemon.logLevel).toBe('error');
    expect(cfg.daemon.webPort).toBe(7700);
    // other sections are defaults
    expect(cfg.scheduler.globalConcurrency).toBe(2);
    expect(cfg.detector.minPollSec).toBe(15);
    expect(cfg.agents.janitor.trigger).toBe('commit');
  });

  it('scope overrides replace defaults entirely', () => {
    const s = ScopeSection.parse({
      include: ['**/*.py'],
      exclude: [],
    });
    expect(s.include).toEqual(['**/*.py']);
    expect(s.exclude).toEqual([]);
  });
});
