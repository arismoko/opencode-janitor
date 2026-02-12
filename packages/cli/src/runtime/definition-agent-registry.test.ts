import { describe, expect, it } from 'bun:test';
import { AGENT_IDS } from '@opencode-janitor/shared';
import { CliConfigSchema } from '../config/schema';
import { createDefinitionAgentRegistry } from './definition-agent-registry';

const defaultAgent = AGENT_IDS[0];

describe('definition agent registry manual context', () => {
  it('injects manual note and focusPath into built prompt', () => {
    const registry = createDefinitionAgentRegistry();
    const spec = registry.get(defaultAgent);
    if (!spec) {
      throw new Error('Expected runtime spec for default agent.');
    }

    const prepared = spec.prepareContext({
      config: CliConfigSchema.parse({}),
      run: {
        id: 'rrn_1',
        repo_id: 'repo_1',
        trigger_event_id: 'tev_1',
        trigger_id: 'manual',
        scope: 'repo',
        path: '/tmp/repo',
        default_branch: 'main',
      },
      trigger: {
        kind: 'manual',
        commitSha: 'abc123',
        commitContext: {
          sha: 'abc123',
          subject: 'manual context',
          parents: [],
          changedFiles: [],
          patch: '',
          patchTruncated: false,
          deletionOnly: false,
        },
        note: 'DO NOTHING JUST SAY HI :3',
        focusPath: 'src/features/payments',
      },
    });

    const prompt = spec.buildPrompt({ preparedContext: prepared });
    expect(prompt).toContain('# USER CONTEXT');
    expect(prompt).toContain('Instruction: DO NOTHING JUST SAY HI :3');
    expect(prompt).toContain('Focus path: src/features/payments');
  });
});
