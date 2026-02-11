import { describe, expect, it } from 'bun:test';
import { agentProfiles, type CommitContext } from '@opencode-janitor/shared';
import { type CliConfig, CliConfigSchema } from '../../config/schema';

const { JANITOR_PROFILE, HUNTER_PROFILE, INSPECTOR_PROFILE, SCRIBE_PROFILE } =
  agentProfiles;

import type { QueuedJobRow } from '../../db/models';
import type {
  CommitTriggerContext,
  ManualTriggerContext,
  PrepareContextInput,
  PrTriggerContext,
  ReviewTriggerKind,
} from '../../runtime/agent-runtime-spec';
import { createHunterSpec } from './hunter-strategy';
import { createInspectorSpec } from './inspector-strategy';
import { createJanitorSpec } from './janitor-strategy';
import { createScribeSpec } from './scribe-strategy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a minimal config with per-agent overrides. */
function makeConfig(
  overrides: Partial<
    Record<
      'janitor' | 'hunter' | 'inspector' | 'scribe',
      Record<string, unknown>
    >
  >,
): CliConfig {
  return CliConfigSchema.parse({
    agents: overrides,
  });
}

const COMMIT_SHA = 'abcdef1234567890abcdef1234567890abcdef12';

function makeCommitContext(partial?: Partial<CommitContext>): CommitContext {
  return {
    sha: COMMIT_SHA,
    subject: 'fix: resolve edge case',
    parents: ['parent1sha'],
    changedFiles: [{ status: 'M', path: 'src/foo.ts' }],
    patch:
      'diff --git a/src/foo.ts b/src/foo.ts\n--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new',
    patchTruncated: false,
    deletionOnly: false,
    ...partial,
  };
}

function makeJob(partial?: Partial<QueuedJobRow>): QueuedJobRow {
  return {
    id: 'job-1',
    repo_id: 'repo-1',
    trigger_id: 'trig-1',
    dedupe_key: 'dk-1',
    attempt: 1,
    max_attempts: 3,
    next_attempt_at: 0,
    queued_at: 0,
    path: '/tmp/test-repo',
    default_branch: 'main',
    kind: 'commit',
    subject_key: 'abc123',
    payload_json: '{}',
    ...partial,
  };
}

function makeCommitTrigger(sha?: string): CommitTriggerContext {
  return {
    kind: 'commit',
    commitSha: sha ?? COMMIT_SHA,
    commitContext: makeCommitContext(),
  };
}

function makePrTrigger(prNumber = 42): PrTriggerContext {
  return {
    kind: 'pr',
    commitSha: COMMIT_SHA,
    commitContext: makeCommitContext(),
    prNumber,
  };
}

function makeManualTrigger(
  commitContextPartial?: Partial<CommitContext>,
): ManualTriggerContext {
  return {
    kind: 'manual',
    commitSha: COMMIT_SHA,
    commitContext: makeCommitContext(commitContextPartial),
  };
}

// ---------------------------------------------------------------------------
// Spec instances
// ---------------------------------------------------------------------------

const janitorSpec = createJanitorSpec(JANITOR_PROFILE);
const hunterSpec = createHunterSpec(HUNTER_PROFILE);
const inspectorSpec = createInspectorSpec(INSPECTOR_PROFILE);
const scribeSpec = createScribeSpec(SCRIBE_PROFILE);

const ALL_SPECS = [
  { name: 'janitor', spec: janitorSpec, defaultTrigger: 'commit' },
  { name: 'hunter', spec: hunterSpec, defaultTrigger: 'pr' },
  { name: 'inspector', spec: inspectorSpec, defaultTrigger: 'manual' },
  { name: 'scribe', spec: scribeSpec, defaultTrigger: 'manual' },
] as const;

// ============================================================================
// 1. supportsTrigger matrix
// ============================================================================

describe('supportsTrigger matrix', () => {
  // -------------------------------------------------------------------------
  // enabled=false → always false
  // -------------------------------------------------------------------------
  describe('enabled=false → always false', () => {
    const kinds: ReviewTriggerKind[] = ['commit', 'pr', 'manual'];

    for (const { name, spec } of ALL_SPECS) {
      for (const kind of kinds) {
        it(`${name}: enabled=false, kind=${kind} → false`, () => {
          const config = makeConfig({ [name]: { enabled: false } });
          expect(spec.supportsTrigger(config, kind)).toBe(false);
        });
      }
    }
  });

  // -------------------------------------------------------------------------
  // trigger='never' → always false
  // -------------------------------------------------------------------------
  describe("trigger='never' → always false", () => {
    const kinds: ReviewTriggerKind[] = ['commit', 'pr', 'manual'];

    for (const { name, spec } of ALL_SPECS) {
      for (const kind of kinds) {
        it(`${name}: trigger=never, kind=${kind} → false`, () => {
          const config = makeConfig({ [name]: { trigger: 'never' } });
          expect(spec.supportsTrigger(config, kind)).toBe(false);
        });
      }
    }
  });

  // -------------------------------------------------------------------------
  // trigger matches kind → true
  // -------------------------------------------------------------------------
  describe('trigger matches kind → true', () => {
    it("janitor: trigger='commit', kind='commit' → true", () => {
      const config = makeConfig({ janitor: { trigger: 'commit' } });
      expect(janitorSpec.supportsTrigger(config, 'commit')).toBe(true);
    });

    it("hunter: trigger='pr', kind='pr' → true", () => {
      const config = makeConfig({ hunter: { trigger: 'pr' } });
      expect(hunterSpec.supportsTrigger(config, 'pr')).toBe(true);
    });

    it("inspector: trigger='manual', kind='manual' → true", () => {
      const config = makeConfig({ inspector: { trigger: 'manual' } });
      expect(inspectorSpec.supportsTrigger(config, 'manual')).toBe(true);
    });

    it("scribe: trigger='manual', kind='manual' → true", () => {
      const config = makeConfig({ scribe: { trigger: 'manual' } });
      expect(scribeSpec.supportsTrigger(config, 'manual')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // trigger='both' → true for commit and pr, false for manual
  // -------------------------------------------------------------------------
  describe("trigger='both'", () => {
    for (const { name, spec } of ALL_SPECS) {
      it(`${name}: trigger=both, kind=commit → true`, () => {
        const config = makeConfig({ [name]: { trigger: 'both' } });
        expect(spec.supportsTrigger(config, 'commit')).toBe(true);
      });

      it(`${name}: trigger=both, kind=pr → true`, () => {
        const config = makeConfig({ [name]: { trigger: 'both' } });
        expect(spec.supportsTrigger(config, 'pr')).toBe(true);
      });

      it(`${name}: trigger=both, kind=manual → false`, () => {
        const config = makeConfig({ [name]: { trigger: 'both' } });
        expect(spec.supportsTrigger(config, 'manual')).toBe(false);
      });
    }
  });

  // -------------------------------------------------------------------------
  // trigger='manual' + kind=commit/pr → false
  // -------------------------------------------------------------------------
  describe("trigger='manual' + non-manual kind → false", () => {
    for (const { name, spec } of ALL_SPECS) {
      it(`${name}: trigger=manual, kind=commit → false`, () => {
        const config = makeConfig({ [name]: { trigger: 'manual' } });
        expect(spec.supportsTrigger(config, 'commit')).toBe(false);
      });

      it(`${name}: trigger=manual, kind=pr → false`, () => {
        const config = makeConfig({ [name]: { trigger: 'manual' } });
        expect(spec.supportsTrigger(config, 'pr')).toBe(false);
      });
    }
  });

  // -------------------------------------------------------------------------
  // trigger mismatch → false
  // -------------------------------------------------------------------------
  describe('trigger mismatch → false', () => {
    it("janitor: trigger='commit', kind='pr' → false", () => {
      const config = makeConfig({ janitor: { trigger: 'commit' } });
      expect(janitorSpec.supportsTrigger(config, 'pr')).toBe(false);
    });

    it("hunter: trigger='pr', kind='commit' → false", () => {
      const config = makeConfig({ hunter: { trigger: 'pr' } });
      expect(hunterSpec.supportsTrigger(config, 'commit')).toBe(false);
    });

    it("inspector: trigger='commit', kind='pr' → false", () => {
      const config = makeConfig({ inspector: { trigger: 'commit' } });
      expect(inspectorSpec.supportsTrigger(config, 'pr')).toBe(false);
    });

    it("scribe: trigger='pr', kind='commit' → false", () => {
      const config = makeConfig({ scribe: { trigger: 'pr' } });
      expect(scribeSpec.supportsTrigger(config, 'commit')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // default trigger values from config schema
  // -------------------------------------------------------------------------
  describe('default trigger values from schema', () => {
    const defaultConfig = makeConfig({});

    it('janitor defaults to trigger=commit → supports commit', () => {
      expect(janitorSpec.supportsTrigger(defaultConfig, 'commit')).toBe(true);
    });

    it('hunter defaults to trigger=pr → supports pr', () => {
      expect(hunterSpec.supportsTrigger(defaultConfig, 'pr')).toBe(true);
    });

    it('inspector defaults to trigger=manual → supports manual', () => {
      expect(inspectorSpec.supportsTrigger(defaultConfig, 'manual')).toBe(true);
    });

    it('scribe defaults to trigger=manual → supports manual', () => {
      expect(scribeSpec.supportsTrigger(defaultConfig, 'manual')).toBe(true);
    });
  });
});

// ============================================================================
// 2. prepareContext golden tests
// ============================================================================

describe('prepareContext', () => {
  const config = makeConfig({});
  const job = makeJob();

  // -------------------------------------------------------------------------
  // Janitor — commit trigger
  // -------------------------------------------------------------------------
  describe('janitor (commit trigger)', () => {
    it('produces correct label and metadata', () => {
      const input: PrepareContextInput = {
        config,
        job,
        trigger: makeCommitTrigger(),
      };

      const result = janitorSpec.prepareContext(input);

      expect(result.reviewContext.label).toBe(
        `${COMMIT_SHA.slice(0, 8)} - fix: resolve edge case`,
      );
      expect(result.reviewContext.metadata).toEqual([
        `SHA: ${COMMIT_SHA}`,
        'Subject: fix: resolve edge case',
        'Parents: parent1sha',
      ]);
      expect(result.reviewContext.mode).toBe('diff');
      if (result.reviewContext.mode === 'diff') {
        expect(result.reviewContext.changedFiles).toEqual([
          { status: 'M', path: 'src/foo.ts' },
        ]);
        expect(result.reviewContext.patchTruncated).toBe(false);
      }
    });

    it('uses workspace diff context for manual trigger when workspace has changes', () => {
      const input: PrepareContextInput = {
        config,
        job,
        trigger: makeManualTrigger(),
      };

      const result = janitorSpec.prepareContext(input);

      expect(result.reviewContext.mode).toBe('diff');
      expect(result.reviewContext.label).toBe('Manual workspace review');
      expect(result.reviewContext.metadata).toContain('Trigger: manual');
      expect(result.reviewContext.metadata).toContain(
        'Mode: staged + unstaged workspace changes',
      );
      if (result.reviewContext.mode === 'diff') {
        expect(result.reviewContext.changedFiles).toEqual([
          { status: 'M', path: 'src/foo.ts' },
        ]);
        expect(result.reviewContext.patch.length).toBeGreaterThan(0);
      }
    });

    it('falls back to repo-wide mode for manual trigger when workspace is clean', () => {
      const input: PrepareContextInput = {
        config,
        job,
        trigger: makeManualTrigger({ changedFiles: [], patch: '' }),
      };

      const result = janitorSpec.prepareContext(input);

      expect(result.reviewContext.mode).toBe('repo');
      expect(result.reviewContext.label).toBe('Manual repo-wide analysis');
      if (result.reviewContext.mode === 'repo') {
        expect(result.reviewContext.reason).toBe('empty-workspace-fallback');
        expect(result.reviewContext.metadata).toContain(
          'Mode: repo-wide fallback (workspace has no local changes)',
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // Hunter — manual trigger
  // -------------------------------------------------------------------------
  describe('hunter (manual trigger)', () => {
    it('uses workspace diff context for manual trigger when workspace has changes', () => {
      const input: PrepareContextInput = {
        config,
        job,
        trigger: makeManualTrigger(),
      };

      const result = hunterSpec.prepareContext(input);

      expect(result.reviewContext.mode).toBe('diff');
      expect(result.reviewContext.label).toBe('Manual workspace review');
      expect(result.reviewContext.metadata).toContain('Trigger: manual');
      expect(result.reviewContext.metadata).toContain(
        'Mode: staged + unstaged workspace changes',
      );
      if (result.reviewContext.mode === 'diff') {
        expect(result.reviewContext.changedFiles).toEqual([
          { status: 'M', path: 'src/foo.ts' },
        ]);
        expect(result.reviewContext.patch.length).toBeGreaterThan(0);
      }
    });

    it('falls back to repo-wide mode for manual trigger when workspace is clean', () => {
      const input: PrepareContextInput = {
        config,
        job,
        trigger: makeManualTrigger({ changedFiles: [], patch: '' }),
      };

      const result = hunterSpec.prepareContext(input);

      expect(result.reviewContext.mode).toBe('repo');
      expect(result.reviewContext.label).toBe('Manual repo-wide analysis');
      if (result.reviewContext.mode === 'repo') {
        expect(result.reviewContext.reason).toBe('empty-workspace-fallback');
        expect(result.reviewContext.metadata).toContain(
          'Mode: repo-wide fallback (workspace has no local changes)',
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // Hunter — PR trigger
  // -------------------------------------------------------------------------
  describe('hunter (PR trigger)', () => {
    it('produces PR-specific label and metadata', () => {
      const input: PrepareContextInput = {
        config,
        job,
        trigger: makePrTrigger(99),
      };

      const result = hunterSpec.prepareContext(input);

      expect(result.reviewContext.label).toBe(
        `PR #99 @ ${COMMIT_SHA.slice(0, 8)}`,
      );
      expect(result.reviewContext.metadata).toContain('PR: #99');
      expect(result.reviewContext.metadata).toContain(`SHA: ${COMMIT_SHA}`);
      expect(result.reviewContext.metadata).toContain(
        'Subject: fix: resolve edge case',
      );
    });

    it('produces commit-style label for commit trigger', () => {
      const input: PrepareContextInput = {
        config,
        job,
        trigger: makeCommitTrigger(),
      };

      const result = hunterSpec.prepareContext(input);

      expect(result.reviewContext.label).toBe(
        `${COMMIT_SHA.slice(0, 8)} - fix: resolve edge case`,
      );
      // No PR metadata for commit triggers
      expect(result.reviewContext.metadata).not.toContain(
        expect.stringContaining('PR:'),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Inspector — manual trigger
  // -------------------------------------------------------------------------
  describe('inspector (manual trigger)', () => {
    it('produces repo-wide label for manual trigger', () => {
      const input: PrepareContextInput = {
        config,
        job,
        trigger: makeManualTrigger(),
      };

      const result = inspectorSpec.prepareContext(input);

      expect(result.reviewContext.mode).toBe('repo');
      expect(result.reviewContext.label).toBe('Manual repo-wide analysis');
      expect(result.reviewContext.metadata).toEqual([
        'Trigger: manual',
        'Mode: full codebase inspection',
      ]);
      if (result.reviewContext.mode === 'repo') {
        expect(result.reviewContext.reason).toBe('manual-repo');
      }
    });

    it('produces commit-style context for commit trigger', () => {
      const input: PrepareContextInput = {
        config,
        job,
        trigger: makeCommitTrigger(),
      };

      const result = inspectorSpec.prepareContext(input);

      expect(result.reviewContext.mode).toBe('diff');
      expect(result.reviewContext.label).toBe(
        `${COMMIT_SHA.slice(0, 8)} - fix: resolve edge case`,
      );
      if (result.reviewContext.mode === 'diff') {
        expect(result.reviewContext.changedFiles).toBeDefined();
        expect(result.reviewContext.patch).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Scribe — commit trigger (avoids git for manual)
  // -------------------------------------------------------------------------
  describe('scribe (commit trigger)', () => {
    it('produces correct label and metadata for commit', () => {
      const input: PrepareContextInput = {
        config,
        job,
        trigger: makeCommitTrigger(),
      };

      const result = scribeSpec.prepareContext(input);

      expect(result.reviewContext.label).toBe(
        `${COMMIT_SHA.slice(0, 8)} - fix: resolve edge case`,
      );
      expect(result.reviewContext.metadata).toContain(`SHA: ${COMMIT_SHA}`);
      expect(result.reviewContext.metadata).toContain(
        'Subject: fix: resolve edge case',
      );
      expect(result.reviewContext.metadata).toContain('Parents: parent1sha');
    });

    it('includes doc index metadata when doc files are changed', () => {
      const ctx = makeCommitContext({
        changedFiles: [
          { status: 'M', path: 'README.md' },
          { status: 'M', path: 'src/foo.ts' },
        ],
      });

      const input: PrepareContextInput = {
        config,
        job,
        trigger: { kind: 'commit', commitSha: COMMIT_SHA, commitContext: ctx },
      };

      const result = scribeSpec.prepareContext(input);

      // Should include doc index metadata line
      const docMeta = result.reviewContext.metadata?.find((m) =>
        m.includes('Documentation files'),
      );
      expect(docMeta).toBeDefined();
      expect(docMeta).toContain('README.md');
    });

    it('omits doc index metadata when no doc files changed', () => {
      const ctx = makeCommitContext({
        changedFiles: [{ status: 'M', path: 'src/foo.ts' }],
      });

      const input: PrepareContextInput = {
        config,
        job,
        trigger: { kind: 'commit', commitSha: COMMIT_SHA, commitContext: ctx },
      };

      const result = scribeSpec.prepareContext(input);

      const docMeta = result.reviewContext.metadata?.find((m) =>
        m.includes('Documentation files'),
      );
      expect(docMeta).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // All strategies pass promptConfig through
  // -------------------------------------------------------------------------
  describe('promptConfig passthrough', () => {
    const customConfig = makeConfig({});

    for (const { name, spec } of ALL_SPECS) {
      // Skip manual-only specs that don't have commitSha in manual triggers
      const trigger =
        name === 'inspector' || name === 'scribe'
          ? makeCommitTrigger()
          : makeCommitTrigger();

      it(`${name}: promptConfig contains scope and maxFindings`, () => {
        const result = spec.prepareContext({
          config: customConfig,
          job,
          trigger,
        });

        expect(result.promptConfig.scopeInclude).toBeDefined();
        expect(result.promptConfig.scopeExclude).toBeDefined();
        expect(result.promptConfig.maxFindings).toBeGreaterThan(0);
      });
    }
  });
});

// ============================================================================
// 3. onSuccess fingerprint mapping
// ============================================================================

describe('onSuccess fingerprint mapping', () => {
  const findings = [
    {
      severity: 'high',
      domain: 'YAGNI',
      location: 'src/foo.ts:10',
      evidence: 'unused import',
      prescription: 'remove it',
    },
    {
      severity: 'low',
      domain: 'DRY',
      location: 'src/bar.ts:20',
      evidence: 'duplicated block',
      prescription: 'extract helper',
    },
  ];

  const baseInput = {
    job: makeJob(),
    runId: 'run-abc',
    output: { findings },
  };

  for (const { name, spec } of ALL_SPECS) {
    describe(name, () => {
      it('produces correct agent name on all rows', () => {
        const rows = spec.onSuccess(baseInput);

        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row.agent).toBe(name);
        }
      });

      it('produces fingerprint in domain:location:severity format', () => {
        const rows = spec.onSuccess(baseInput);

        expect(rows[0].fingerprint).toBe('YAGNI:src/foo.ts:10:high');
        expect(rows[1].fingerprint).toBe('DRY:src/bar.ts:20:low');
      });

      it('maps job and run IDs correctly', () => {
        const rows = spec.onSuccess(baseInput);

        for (const row of rows) {
          expect(row.repo_id).toBe('repo-1');
          expect(row.job_id).toBe('job-1');
          expect(row.agent_run_id).toBe('run-abc');
        }
      });

      it('maps all finding fields', () => {
        const rows = spec.onSuccess(baseInput);

        expect(rows[0]).toMatchObject({
          severity: 'high',
          domain: 'YAGNI',
          location: 'src/foo.ts:10',
          evidence: 'unused import',
          prescription: 'remove it',
        });
      });

      it('returns empty array for zero findings', () => {
        const rows = spec.onSuccess({
          ...baseInput,
          output: { findings: [] },
        });

        expect(rows).toEqual([]);
      });
    });
  }
});

// ============================================================================
// 4. Spec identity and profile wiring
// ============================================================================

describe('spec identity and profile wiring', () => {
  it.each([
    { name: 'janitor' as const, spec: janitorSpec, profile: JANITOR_PROFILE },
    { name: 'hunter' as const, spec: hunterSpec, profile: HUNTER_PROFILE },
    {
      name: 'inspector' as const,
      spec: inspectorSpec,
      profile: INSPECTOR_PROFILE,
    },
    { name: 'scribe' as const, spec: scribeSpec, profile: SCRIBE_PROFILE },
  ])('$name: agent name, configKey, and profile are correct', ({
    name,
    spec,
    profile,
  }) => {
    expect(spec.agent).toBe(name);
    expect(spec.configKey).toBe(name);
    expect(spec.profile).toBe(profile);
  });
});

// ============================================================================
// 5. maxFindings, modelId, variant config resolution
// ============================================================================

describe('config resolution helpers', () => {
  describe('maxFindings', () => {
    it('returns default maxFindings from schema', () => {
      const config = makeConfig({});
      for (const { spec } of ALL_SPECS) {
        expect(spec.maxFindings(config)).toBe(10);
      }
    });

    it('returns overridden maxFindings', () => {
      const config = makeConfig({ janitor: { maxFindings: 5 } });
      expect(janitorSpec.maxFindings(config)).toBe(5);
    });
  });

  describe('modelId', () => {
    it('falls back to defaultModelId when agent has none', () => {
      const config = makeConfig({});
      // defaultModelId defaults to '' from schema
      for (const { spec } of ALL_SPECS) {
        expect(spec.modelId(config)).toBe('');
      }
    });

    it('uses agent-specific modelId when set', () => {
      const config = CliConfigSchema.parse({
        agents: { janitor: { modelId: 'anthropic/claude-3' } },
      });
      expect(janitorSpec.modelId(config)).toBe('anthropic/claude-3');
    });

    it('falls back to defaultModelId when agent modelId not set', () => {
      const config = CliConfigSchema.parse({
        opencode: { defaultModelId: 'openai/gpt-4' },
      });
      expect(janitorSpec.modelId(config)).toBe('openai/gpt-4');
    });
  });

  describe('variant', () => {
    it('returns undefined by default', () => {
      const config = makeConfig({});
      for (const { spec } of ALL_SPECS) {
        expect(spec.variant(config)).toBeUndefined();
      }
    });

    it('returns variant when set', () => {
      const config = CliConfigSchema.parse({
        agents: { hunter: { variant: 'strict' } },
      });
      expect(hunterSpec.variant(config)).toBe('strict');
    });
  });
});
