export function renderFindingEnrichment({ html, section }) {
  const payload =
    section && typeof section.payload === 'object' && section.payload
      ? section.payload
      : {};

  const keys = Object.keys(payload);

  return {
    summaryChips: html`
      <span class="enrichment-chip">smoke v${section.version}</span>
      <span class="enrichment-chip">${keys.length} keys</span>
    `,
    body: html`
      <p class="enrichment-copy">Generic smoke renderer loaded successfully.</p>
    `,
  };
}
