import { useEffect, useState } from 'https://esm.sh/preact@10.26.2/hooks';
import { ensureFindingEnrichmentRenderer } from './registry.js';

export function useEnrichmentRenderers(rendererKeys) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!Array.isArray(rendererKeys) || rendererKeys.length === 0) {
      return;
    }

    let cancelled = false;

    Promise.all(
      rendererKeys.map((rendererKey) =>
        ensureFindingEnrichmentRenderer(rendererKey),
      ),
    )
      .then(() => {
        if (!cancelled) {
          setVersion((value) => value + 1);
        }
      })
      .catch(() => {
        // ensureFindingEnrichmentRenderer is fail-safe and returns fallback.
      });

    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(rendererKeys)]);

  return version;
}
