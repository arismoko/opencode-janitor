export function renderFindingEnrichment({ html, section }) {
  return {
    summaryChips: html`
      <span class="enrichment-chip">v${section.version}</span>
    `,
    body: html`
      <p class="enrichment-copy">
        No renderer is registered for this enrichment type.
      </p>
    `,
  };
}

export const renderFallbackEnrichment = renderFindingEnrichment;
