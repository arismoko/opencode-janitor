import { describe, expect, it } from 'bun:test';
import { renderFindingEnrichment as fallbackRenderer } from '../renderers/generic/fallback.js';
import {
  ensureFindingEnrichmentRenderer,
  resolveFindingEnrichmentRenderer,
} from './registry.js';

describe('finding enrichment renderer registry', () => {
  it('loads renderer module using namespaced key convention', async () => {
    const initial = resolveFindingEnrichmentRenderer(
      'inspector.architecture.v1',
    );
    expect(initial).toBe(fallbackRenderer);

    const loaded = await ensureFindingEnrichmentRenderer(
      'Inspector.Architecture.V1',
    );
    expect(typeof loaded).toBe('function');

    const resolved = resolveFindingEnrichmentRenderer(
      'inspector.architecture.v1',
    );
    expect(resolved).toBe(loaded);
    expect(resolved).not.toBe(fallbackRenderer);
  });

  it('returns fallback for malformed renderer keys', async () => {
    expect(resolveFindingEnrichmentRenderer('../bad-key')).toBe(
      fallbackRenderer,
    );
    expect(resolveFindingEnrichmentRenderer('architecture.v2')).toBe(
      fallbackRenderer,
    );
    const loaded = await ensureFindingEnrichmentRenderer('../bad-key');
    expect(loaded).toBe(fallbackRenderer);
  });

  it('returns fallback for missing renderer modules and caches result', async () => {
    const first = await ensureFindingEnrichmentRenderer(
      'inspector.missing.v999',
    );
    const second = await ensureFindingEnrichmentRenderer(
      'inspector.missing.v999',
    );

    expect(first).toBe(fallbackRenderer);
    expect(second).toBe(fallbackRenderer);
    expect(resolveFindingEnrichmentRenderer('inspector.missing.v999')).toBe(
      fallbackRenderer,
    );
  });
});
