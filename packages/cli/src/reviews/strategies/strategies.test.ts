import { describe, expect, it } from 'bun:test';
import { agentProfiles, type CommitContext } from '@opencode-janitor/shared';
import { type CliConfig, CliConfigSchema } from '../../config/schema';
import type { QueuedJobRow } from '../../db/models';
import type {
  CommitTriggerContext,
  ManualTriggerContext,
  PrTriggerContext,
} from '../../runtime/agent-runtime-spec';
import { createHunterSpec } from './hunter-strategy';
import { createInspectorSpec } from './inspector-strategy';
import { createJanitorSpec } from './janitor-strategy';
import { createScribeSpec } from './scribe-strategy';

const { JANITOR_PROFILE, HUNTER_PROFILE, INSPECTOR_PROFILE, SCRIBE_PROFILE } =
  agentProfiles;

const janitorSpec = createJanitorSpec(JANITOR_PROFILE);
const hunterSpec = createHunterSpec(HUNTER_PROFILE);
const inspectorSpec = createInspectorSpec(INSPECTOR_PROFILE);
const scribeSpec = createScribeSpec(SCRIBE_PROFILE);

const SHA = 'abcdef1234567890abcdef1234567890abcdef12';

function makeConfig(overrides: Record<string, unknown> = {}): CliConfig {
  return CliConfigSchema.parse({ agents: overrides });
}

function makeCommitContext(partial?: Partial<CommitContext>): CommitContext {
  return {
    sha: SHA,
    subject: 'fix: edge case',
    parents: ['parentsha'],
    changedFiles: [{ status: 'M', path: 'src/file.ts' }],
    patch: 'diff --git a/src/file.ts b/src/file.ts\n@@ -1 +1 @@\n-old\n+new',
    patchTruncated: false,
    deletionOnly: false,
    ...partial,
  };
}

function makeJob(partial?: Partial<QueuedJobRow>): QueuedJobRow {
  return {
    id: 'job-1',
    repo_id: 'repo-1',
    trigger_id: 'trg-1',
    dedupe_key: 'repo-1:commit:abc',
    attempt: 1,
    max_attempts: 3,
    next_attempt_at: 0,
    queued_at: 0,
    path: '/tmp/repo',
    default_branch: 'main',
    kind: 'commit',
    subject_key: 'commit:abc',
    payload_json: '{}',
    ...partial,
  };
}

function makeCommitTrigger(): CommitTriggerContext {
  return {
    kind: 'commit',
    commitSha: SHA,
    commitContext: makeCommitContext(),
  };
}

function makePrTrigger(prNumber = 7): PrTriggerContext {
  return {
    kind: 'pr',
    commitSha: SHA,
    commitContext: makeCommitContext(),
    prNumber,
  };
}

function makeManualTrigger(
  commitContextPartial?: Partial<CommitContext>,
): ManualTriggerContext {
  return {
    kind: 'manual',
    commitSha: SHA,
    commitContext: makeCommitContext(commitContextPartial),
  };
}

describe('supportsTrigger', () => {
  it('returns false for disabled agents', () => {
    const config = makeConfig({ janitor: { enabled: false } });
    expect(janitorSpec.supportsTrigger(config, 'commit')).toBe(false);
    expect(janitorSpec.supportsTrigger(config, 'manual')).toBe(false);
  });

  it('uses autoTriggers for commit/pr and always allows manual when enabled', () => {
    const config = makeConfig({
      hunter: { autoTriggers: ['commit'] },
    });

    expect(hunterSpec.supportsTrigger(config, 'commit')).toBe(true);
    expect(hunterSpec.supportsTrigger(config, 'pr')).toBe(false);
    expect(hunterSpec.supportsTrigger(config, 'manual')).toBe(true);
  });

  it('respects registry defaults from config schema', () => {
    const config = makeConfig();
    expect(janitorSpec.supportsTrigger(config, 'commit')).toBe(true);
    expect(hunterSpec.supportsTrigger(config, 'pr')).toBe(true);
    expect(inspectorSpec.supportsTrigger(config, 'commit')).toBe(false);
    expect(scribeSpec.supportsTrigger(config, 'pr')).toBe(false);
  });
});

describe('prepareContext', () => {
  const config = makeConfig();
  const job = makeJob();

  it('hunter builds PR-aware diff context', () => {
    const result = hunterSpec.prepareContext({
      config,
      job,
      trigger: makePrTrigger(99),
    });

    expect(result.reviewContext.mode).toBe('diff');
    expect(result.reviewContext.label).toContain('PR #99');
    expect(result.reviewContext.metadata).toContain('PR: #99');
  });

  it('janitor manual trigger falls back to repo mode when workspace is clean', () => {
    const result = janitorSpec.prepareContext({
      config,
      job,
      trigger: makeManualTrigger({ changedFiles: [], patch: '' }),
    });

    expect(result.reviewContext.mode).toBe('repo');
    if (result.reviewContext.mode === 'repo') {
      expect(result.reviewContext.reason).toBe('empty-workspace-fallback');
    }
  });

  it('inspector manual trigger is repo-wide with manual reason', () => {
    const result = inspectorSpec.prepareContext({
      config,
      job,
      trigger: makeManualTrigger(),
    });

    expect(result.reviewContext.mode).toBe('repo');
    if (result.reviewContext.mode === 'repo') {
      expect(result.reviewContext.reason).toBe('manual-repo');
    }
  });

  it('scribe commit trigger keeps diff mode', () => {
    const result = scribeSpec.prepareContext({
      config,
      job,
      trigger: makeCommitTrigger(),
    });

    expect(result.reviewContext.mode).toBe('diff');
  });
});

describe('onSuccess mapping', () => {
  it('maps findings to persistable rows with fingerprint', () => {
    const rows = janitorSpec.onSuccess({
      job: makeJob(),
      runId: 'run-1',
      output: {
        findings: [
          {
            severity: 'P1',
            domain: 'DRY',
            location: 'src/file.ts:10',
            evidence: 'duplicate block',
            prescription: 'extract helper',
          },
        ],
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.agent).toBe('janitor');
    expect(rows[0]?.fingerprint).toBe('DRY:src/file.ts:10:P1');
  });
});

describe('config helper resolution', () => {
  it('resolves maxFindings, modelId fallback, and variant', () => {
    const config = CliConfigSchema.parse({
      opencode: { defaultModelId: 'openai/gpt-4o' },
      agents: {
        hunter: {
          maxFindings: 5,
          variant: 'strict',
        },
      },
    });

    expect(hunterSpec.maxFindings(config)).toBe(5);
    expect(hunterSpec.modelId(config)).toBe('openai/gpt-4o');
    expect(hunterSpec.variant(config)).toBe('strict');
  });
});
