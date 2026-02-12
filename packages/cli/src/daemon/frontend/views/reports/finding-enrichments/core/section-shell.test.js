import { describe, expect, it } from 'bun:test';
import { AGENT_IDS } from '@opencode-janitor/shared';
import {
  enrichmentKey,
  findEnrichmentDefinition,
  normalizeEnrichmentSection,
} from './section-shell.js';

describe('finding enrichment section shell helpers', () => {
  it('normalizes valid enrichment section shape', () => {
    const normalized = normalizeEnrichmentSection({
      kind: 'architecture',
      version: 1,
      payload: { a: 1 },
      collapsed: true,
    });

    expect(normalized).toEqual({
      kind: 'architecture',
      version: 1,
      payload: { a: 1 },
      collapsed: true,
    });
  });

  it('drops malformed sections', () => {
    expect(normalizeEnrichmentSection(null)).toBeNull();
    expect(
      normalizeEnrichmentSection({ kind: '', version: 1, payload: {} }),
    ).toBeNull();
    expect(
      normalizeEnrichmentSection({
        kind: 'architecture',
        version: '1',
        payload: {},
      }),
    ).toBeNull();
    expect(
      normalizeEnrichmentSection({
        kind: 'architecture',
        version: 1,
        payload: null,
      }),
    ).toBeNull();
  });

  it('finds enrichment definition by agent and kind', () => {
    const agentId = AGENT_IDS[0];
    const capabilities = {
      agents: [
        {
          id: agentId,
          findingEnrichments: [
            {
              kind: 'architecture',
              title: 'Architecture',
              renderer: 'generic.smoke.v1',
              collapsedByDefault: true,
            },
          ],
        },
      ],
    };

    expect(
      findEnrichmentDefinition(capabilities, agentId, 'architecture'),
    ).toEqual({
      kind: 'architecture',
      title: 'Architecture',
      renderer: 'generic.smoke.v1',
      collapsedByDefault: true,
    });
    expect(findEnrichmentDefinition(capabilities, agentId, 'unknown')).toBe(
      null,
    );
  });

  it('builds stable enrichment keys', () => {
    const finding = {
      id: 'fnd_123',
      reviewRunId: 'rrn_1',
      location: 'src/core.ts:10',
    };
    const section = { kind: 'architecture', version: 1, payload: {} };

    expect(enrichmentKey(finding, 0, section, 0)).toBe(
      'fnd_123:0:architecture:v1',
    );
  });
});
