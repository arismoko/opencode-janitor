import { describe, expect, it } from 'bun:test';
import { AGENT_IDS, AGENTS } from '@opencode-janitor/shared';
import { createAgentSpecFromDefinition } from './agent-spec-from-definition';

const architectureAgentId = AGENT_IDS.find((agentId) =>
  AGENTS[agentId].findingEnrichments?.definitions.some(
    (d) => d.kind === 'architecture',
  ),
);
const cleanupAgentId = AGENT_IDS.find((agentId) =>
  AGENTS[agentId].findingEnrichments?.definitions.some(
    (d) => d.kind === 'cleanup-map',
  ),
);

if (!architectureAgentId || !cleanupAgentId) {
  throw new Error('Expected both architecture and cleanup agent profiles.');
}

function makeSpec(agent: (typeof AGENT_IDS)[number]) {
  return createAgentSpecFromDefinition({
    agent,
    buildPreparedContext: () => {
      throw new Error('not used in onSuccess tests');
    },
  });
}

const baseRun = {
  id: 'rrn_1',
  repo_id: 'repo_1',
  trigger_event_id: 'tev_1',
  trigger_id: 'manual' as const,
  scope: 'repo' as const,
  path: '/tmp/repo',
  default_branch: 'main',
};

describe('createAgentSpecFromDefinition.onSuccess', () => {
  it('serializes architecture metadata as generic enrichments array', () => {
    const spec = makeSpec(architectureAgentId);
    const rows = spec.onSuccess({
      run: baseRun,
      reviewRunId: baseRun.id,
      output: {
        findings: [
          {
            severity: 'P1',
            domain: 'DESIGN',
            location: 'src/core.ts:10',
            evidence: 'Boundary leakage',
            prescription: 'Introduce ports',
            architecture: {
              principles: ['DEPENDENCY_INVERSION'],
              antiPattern: {
                label: 'LAYERING_VIOLATION',
                detail: 'Domain reaches infrastructure',
              },
              recommendedPattern: {
                label: 'HEXAGONAL_PORTS_ADAPTERS',
                detail: 'Use ports around domain boundaries.',
              },
              rewritePlan: ['Define ports', 'Move adapters'],
              tradeoffs: ['More interfaces'],
              impactScope: 'SUBSYSTEM',
            },
          },
        ],
      },
    });

    expect(rows).toHaveLength(1);
    const details = JSON.parse(rows[0]!.details_json) as {
      enrichments?: Array<{
        kind?: string;
        version?: number;
        payload?: unknown;
      }>;
    };
    expect(details.enrichments).toHaveLength(1);
    expect(details.enrichments?.[0]?.kind).toBe('architecture');
    expect(details.enrichments?.[0]?.version).toBe(1);
  });

  it('serializes cleanup enrichments for cleanup-map findings', () => {
    const spec = makeSpec(cleanupAgentId);
    const rows = spec.onSuccess({
      run: baseRun,
      reviewRunId: baseRun.id,
      output: {
        findings: [
          {
            severity: 'P2',
            domain: 'DRY',
            location: 'src/a.ts:1',
            evidence: 'Duplicated branch',
            prescription: 'Extract helper',
            cleanupMap: {
              action: 'EXTRACT',
              effort: 'SMALL',
              linesAffected: 12,
              targets: ['src/a.ts:branchA', 'src/b.ts:branchB'],
              safetyNote:
                'Both branches are identical and share no mutable state.',
            },
          },
        ],
      },
    });

    expect(rows).toHaveLength(1);
    const details = JSON.parse(rows[0]!.details_json) as {
      enrichments?: Array<{
        kind?: string;
        version?: number;
        payload?: unknown;
      }>;
    };
    expect(details.enrichments).toHaveLength(1);
    expect(details.enrichments?.[0]?.kind).toBe('cleanup-map');
    expect(details.enrichments?.[0]?.version).toBe(1);
  });
});
