import { describe, expect, it } from 'bun:test';
import {
  HunterOutput,
  InspectorOutput,
  JanitorOutput,
  Severity,
} from './finding-schemas';

describe('finding schemas', () => {
  it('accepts valid janitor output', () => {
    const parsed = JanitorOutput.parse({
      findings: [
        {
          domain: 'YAGNI',
          location: 'src/file.ts:12',
          severity: 'P1',
          evidence: 'unused abstraction introduced in this change',
          prescription: 'inline the abstraction and remove the wrapper',
        },
      ],
    });

    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.domain).toBe('YAGNI');
  });

  it('rejects invalid severity values', () => {
    const result = HunterOutput.safeParse({
      findings: [
        {
          domain: 'BUG',
          location: 'src/api.ts:33',
          severity: 'LOW',
          evidence: 'bad enum value',
          prescription: 'use P0-P3 severity',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('exposes canonical severity options', () => {
    expect(Severity.options).toEqual(['P0', 'P1', 'P2', 'P3']);
  });

  it('accepts inspector finding with required architecture block', () => {
    const parsed = InspectorOutput.parse({
      findings: [
        {
          domain: 'DESIGN',
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

    expect(parsed.findings[0]?.architecture.impactScope).toBe('SUBSYSTEM');
  });

  it('rejects inspector finding missing architecture block', () => {
    const result = InspectorOutput.safeParse({
      findings: [
        {
          domain: 'SMELL',
          location: 'src/service.ts:11',
          severity: 'P2',
          evidence: 'Cross-module call shape is unstable.',
          prescription: 'Consolidate contract into dedicated boundary type.',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('enforces recommendedPattern.custom only with label OTHER', () => {
    const missingCustom = InspectorOutput.safeParse({
      findings: [
        {
          domain: 'DESIGN',
          location: 'src/core.ts:31',
          severity: 'P2',
          evidence: 'Current flow has no named pattern fit.',
          prescription: 'Adopt custom architecture pattern.',
          architecture: {
            principles: ['SEPARATION_OF_CONCERNS'],
            antiPattern: {
              label: 'NONE',
              detail: 'No single anti-pattern dominates.',
            },
            recommendedPattern: {
              label: 'OTHER',
              detail: 'Domain-specific event choreography pattern is needed.',
            },
            rewritePlan: ['Document target shape', 'Codify boundary contract'],
            tradeoffs: ['Custom pattern needs strong docs'],
            impactScope: 'LOCAL',
          },
        },
      ],
    });
    expect(missingCustom.success).toBe(false);

    const unexpectedCustom = InspectorOutput.safeParse({
      findings: [
        {
          domain: 'DESIGN',
          location: 'src/core.ts:31',
          severity: 'P2',
          evidence: 'Known pattern applies.',
          prescription: 'Use template-method style extraction.',
          architecture: {
            principles: ['OPEN_CLOSED'],
            antiPattern: {
              label: 'BOOLEAN_PARAMETER',
              detail: 'Flag arguments fork behavior.',
            },
            recommendedPattern: {
              label: 'TEMPLATE_METHOD',
              detail:
                'Lift shared flow into a template and isolate variant hooks.',
              custom: 'this should not be here',
            },
            rewritePlan: [
              'Split variant hooks',
              'Lift shared flow to template',
            ],
            tradeoffs: ['Slight abstraction overhead'],
            impactScope: 'LOCAL',
          },
        },
      ],
    });
    expect(unexpectedCustom.success).toBe(false);
  });

  it('requires recommendedPattern.detail', () => {
    const result = InspectorOutput.safeParse({
      findings: [
        {
          domain: 'DESIGN',
          location: 'src/core.ts:31',
          severity: 'P2',
          evidence: 'Pattern recommendation lacks detail.',
          prescription: 'Provide concrete target-shape detail.',
          architecture: {
            principles: ['OPEN_CLOSED'],
            antiPattern: {
              label: 'BOOLEAN_PARAMETER',
              detail: 'Flag arguments fork behavior.',
            },
            recommendedPattern: {
              label: 'TEMPLATE_METHOD',
            },
            rewritePlan: [
              'Split variant hooks',
              'Lift shared flow to template',
            ],
            tradeoffs: ['Slight abstraction overhead'],
            impactScope: 'LOCAL',
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
