export function renderFindingEnrichment({ html, section }) {
  const payload =
    section && typeof section.payload === 'object' && section.payload
      ? section.payload
      : {};

  const keys = Object.keys(payload);

  return {
    summaryChips: html`
      <span class="architecture-chip">smoke v${section.version}</span>
      <span class="architecture-chip">${keys.length} keys</span>
    `,
    body: html`
      <p class="architecture-copy">Generic smoke renderer loaded successfully.</p>
    `,
  };
}
