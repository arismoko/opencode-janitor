import { describe, expect, it } from 'bun:test';
import { AGENT_IDS, AGENTS } from '../agents';
import { OUTPUT_SCHEMAS, Severity } from './finding-schemas';

const architectureAgentId = AGENT_IDS.find((agentId) =>
  AGENTS[agentId].findingEnrichments?.definitions.some(
    (d) => d.kind === 'architecture',
  ),
);

if (!architectureAgentId) {
  throw new Error('Expected at least one agent with finding enrichments.');
}

// Pick an agent whose schema we can construct a minimal valid finding for.
// All agents now have enrichments, so we use a BUG-domain agent as
// a simple representative and provide its required bugAnalysis block.
const simpleAgentId = AGENT_IDS.find((agentId) =>
  AGENTS[agentId].domains.includes('BUG'),
);

if (!simpleAgentId) {
  throw new Error('Expected a bug-domain agent for basic schema tests.');
}

describe('finding schemas', () => {
  it('accepts valid output for a simple agent schema', () => {
    const parsed = OUTPUT_SCHEMAS[simpleAgentId].parse({
      findings: [
        {
          domain: AGENTS[simpleAgentId].domains[0] as string,
          location: 'src/file.ts:12',
          severity: 'P1',
          evidence: 'valid finding payload',
          prescription: 'apply a concrete fix',
          bugAnalysis: {
            category: 'LOGIC_ERROR',
            failureMode: 'SILENT_WRONG_RESULT',
            blastRadius: 'ISOLATED',
            confidence: 'HIGH',
            triggerConditions: ['specific condition triggers the defect'],
            affectedPaths: ['src/file.ts:fn()'],
          },
        },
      ],
    });

    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.domain).toBe(
      AGENTS[simpleAgentId].domains[0] as any,
    );
  });

  it('rejects invalid severity values', () => {
    const result = OUTPUT_SCHEMAS[simpleAgentId].safeParse({
      findings: [
        {
          domain: AGENTS[simpleAgentId].domains[0] as string,
          location: 'src/api.ts:33',
          severity: 'LOW',
          evidence: 'bad enum value',
          prescription: 'use P0-P3 severity',
          bugAnalysis: {
            category: 'LOGIC_ERROR',
            failureMode: 'CRASH',
            blastRadius: 'ISOLATED',
            confidence: 'HIGH',
            triggerConditions: ['trigger'],
            affectedPaths: ['path'],
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('exposes canonical severity options', () => {
    expect(Severity.options).toEqual(['P0', 'P1', 'P2', 'P3']);
  });

  it('accepts enriched finding with required architecture block', () => {
    const parsed = OUTPUT_SCHEMAS[architectureAgentId].parse({
      findings: [
        {
          domain: AGENTS[architectureAgentId].domains[0] as string,
          location: 'src/runtime/orchestrator.ts:88',
          severity: 'P1',
          evidence: 'Orchestrator reaches directly into repository internals.',
          prescription:
            'Extract a boundary-facing service and invert dependency direction.',
          architecture: {
            principles: ['DEPENDENCY_INVERSION', 'EXPLICIT_BOUNDARIES'],
            antiPattern: {
              label: 'LAYERING_VIOLATION',
              detail:
                'UI-layer concerns leak into scheduler orchestration path.',
            },
            recommendedPattern: {
              label: 'HEXAGONAL_PORTS_ADAPTERS',
              detail:
                'Introduce ports for orchestration dependencies and isolate adapters at the edges.',
            },
            rewritePlan: [
              'Define a port interface for review-run persistence.',
              'Move DB access into adapters implementing that port.',
              'Inject the port into orchestrator entrypoint.',
            ],
            tradeoffs: [
              'More interfaces to maintain',
              'Slight upfront wiring cost',
            ],
            impactScope: 'SUBSYSTEM',
          },
        },
      ],
    });

    const finding = parsed.findings[0] as Record<string, unknown>;
    const architecture = finding.architecture as Record<string, unknown>;
    expect(architecture.impactScope).toBe('SUBSYSTEM');
  });

  it('rejects enriched finding missing architecture block', () => {
    const result = OUTPUT_SCHEMAS[architectureAgentId].safeParse({
      findings: [
        {
          domain: AGENTS[architectureAgentId].domains[0] as string,
          location: 'src/service.ts:11',
          severity: 'P2',
          evidence: 'Cross-module call shape is unstable.',
          prescription: 'Consolidate contract into dedicated boundary type.',
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
