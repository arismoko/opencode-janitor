import { renderFindingEnrichment as fallbackRenderer } from '../renderers/generic/fallback.js';

const rendererCache = new Map();
const inflightLoads = new Map();

const KEY_PATTERN = /^([a-z0-9-]+)\.([a-z0-9-]+)\.v([0-9]+)$/;

function parseRendererKey(rendererKey) {
  if (typeof rendererKey !== 'string') return null;
  const trimmed = rendererKey.trim().toLowerCase();
  if (!trimmed) return null;

  const match = KEY_PATTERN.exec(trimmed);
  if (!match) return null;

  const namespace = match[1];
  const name = match[2];
  const major = Number(match[3]);
  if (!Number.isInteger(major) || major < 0) {
    return null;
  }

  return {
    key: trimmed,
    namespace,
    name,
    major,
  };
}

function modulePathFromParsedKey(parsed) {
  const fileName = `${parsed.name}-v${parsed.major}.js`;
  if (parsed.namespace === 'generic') {
    return `../renderers/generic/${fileName}`;
  }
  return `../renderers/agents/${parsed.namespace}/${fileName}`;
}

function rendererFromModule(moduleValue) {
  if (typeof moduleValue?.renderFindingEnrichment === 'function') {
    return moduleValue.renderFindingEnrichment;
  }
  return fallbackRenderer;
}

export function resolveFindingEnrichmentRenderer(rendererKey) {
  const parsed = parseRendererKey(rendererKey);
  if (!parsed) {
    return fallbackRenderer;
  }
  return rendererCache.get(parsed.key) ?? fallbackRenderer;
}

export async function ensureFindingEnrichmentRenderer(rendererKey) {
  const parsed = parseRendererKey(rendererKey);
  if (!parsed) {
    return fallbackRenderer;
  }

  const cached = rendererCache.get(parsed.key);
  if (cached) {
    return cached;
  }

  const loading = inflightLoads.get(parsed.key);
  if (loading) {
    return loading;
  }

  const loadPromise = import(modulePathFromParsedKey(parsed))
    .then((moduleValue) => {
      const renderer = rendererFromModule(moduleValue);
      rendererCache.set(parsed.key, renderer);
      return renderer;
    })
    .catch(() => {
      rendererCache.set(parsed.key, fallbackRenderer);
      return fallbackRenderer;
    })
    .finally(() => {
      inflightLoads.delete(parsed.key);
    });

  inflightLoads.set(parsed.key, loadPromise);
  return loadPromise;
}
