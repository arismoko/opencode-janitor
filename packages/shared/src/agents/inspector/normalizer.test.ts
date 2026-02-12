import { describe, expect, it } from 'bun:test';
import { normalizeInspectorFinding } from './normalizer';

describe('normalizeInspectorFinding', () => {
  it('canonicalizes known recommended-pattern aliases', () => {
    const finding = {
      architecture: {
        antiPattern: { label: 'layering_violation', detail: 'x' },
        recommendedPattern: { label: 'Template Method', detail: 'x' },
      },
    } as Record<string, unknown>;

    normalizeInspectorFinding(finding);

    const architecture = finding.architecture as {
      recommendedPattern: { label: string };
    };
    expect(architecture.recommendedPattern.label).toBe('TEMPLATE_METHOD');
  });

  it('is a no-op when architecture fields are missing', () => {
    const finding = { severity: 'P1' } as Record<string, unknown>;
    normalizeInspectorFinding(finding);
    expect(finding).toEqual({ severity: 'P1' });
  });

  it('leaves unknown labels unchanged for fail-closed schema rejection', () => {
    const finding = {
      architecture: {
        antiPattern: { label: 'Unknown Pattern', detail: 'x' },
        recommendedPattern: { label: 'Totally Unknown Pattern', detail: 'x' },
      },
    } as Record<string, unknown>;

    normalizeInspectorFinding(finding);

    const architecture = finding.architecture as {
      antiPattern: { label: string };
      recommendedPattern: { label: string };
    };

    expect(architecture.antiPattern.label).toBe('Unknown Pattern');
    expect(architecture.recommendedPattern.label).toBe(
      'Totally Unknown Pattern',
    );
  });
});
