import { describe, expect, it } from 'bun:test';
import { AGENT_IDS, AGENTS } from '@opencode-janitor/shared';
import {
  mapDashboardFindingRow,
  mapDashboardReportSummaryRow,
} from './dashboard-mappers';

const architectureAgent =
  AGENT_IDS.find(
    (agentId) =>
      (AGENTS[agentId].findingEnrichments?.definitions.length ?? 0) > 0,
  ) ?? AGENT_IDS[0];
const defaultAgent = AGENT_IDS[0];

describe('dashboard mappers', () => {
  it('maps enrichments details_json into finding payload', () => {
    const mapped = mapDashboardFindingRow({
      id: 'fnd_1',
      repo_id: 'repo_1',
      repo_path: '/tmp/repo',
      trigger_event_id: 'tev_1',
      review_run_id: 'rrn_1',
      agent: architectureAgent,
      severity: 'P1',
      domain: 'DESIGN',
      location: 'src/core.ts:10',
      evidence: 'Boundary leakage detected',
      prescription: 'Introduce adapter boundary',
      details_json: JSON.stringify({
        enrichments: [
          {
            kind: 'architecture',
            version: 1,
            payload: {
              principles: ['DEPENDENCY_INVERSION'],
              antiPattern: {
                label: 'LAYERING_VIOLATION',
                detail: 'Domain reaches storage layer directly',
              },
              recommendedPattern: {
                label: 'HEXAGONAL_PORTS_ADAPTERS',
                detail:
                  'Route infrastructure dependencies through ports to isolate adapters.',
              },
              rewritePlan: ['Define port', 'Move implementation to adapter'],
              tradeoffs: ['More interfaces'],
              impactScope: 'SUBSYSTEM',
            },
          },
        ],
      }),
      created_at: Date.now(),
    });

    expect(mapped.enrichments?.[0]?.kind).toBe('architecture');
    const payload = mapped.enrichments?.[0]?.payload as {
      recommendedPattern?: { label?: string };
      impactScope?: string;
    };
    expect(payload.impactScope).toBe('SUBSYSTEM');
    expect(payload.recommendedPattern?.label).toBe('HEXAGONAL_PORTS_ADAPTERS');
  });

  it('falls back safely when details_json is malformed', () => {
    const mapped = mapDashboardFindingRow({
      id: 'fnd_2',
      repo_id: 'repo_1',
      repo_path: '/tmp/repo',
      trigger_event_id: 'tev_1',
      review_run_id: 'rrn_1',
      agent: architectureAgent,
      severity: 'P2',
      domain: 'SMELL',
      location: 'src/core.ts:22',
      evidence: 'Malformed details payload should not crash mapper',
      prescription: 'Ignore bad details payload',
      details_json: '{not-valid-json',
      created_at: Date.now(),
    });

    expect(mapped.enrichments).toBeUndefined();
  });

  it('keeps summary mapping unchanged for compatibility', () => {
    const mapped = mapDashboardReportSummaryRow({
      id: 'rrn_1',
      repo_id: 'repo_1',
      repo_path: '/tmp/repo',
      trigger_event_id: 'tev_1',
      subject: 'commit:abc',
      agent: defaultAgent,
      session_id: null,
      status: 'succeeded',
      outcome: 'succeeded',
      findings_count: 2,
      p0_count: 0,
      p1_count: 1,
      p2_count: 1,
      p3_count: 0,
      started_at: Date.now() - 1000,
      finished_at: Date.now(),
      error_message: null,
    });

    expect(mapped.findingsCount).toBe(2);
    expect(mapped.agent).toBe(defaultAgent);
  });
});
