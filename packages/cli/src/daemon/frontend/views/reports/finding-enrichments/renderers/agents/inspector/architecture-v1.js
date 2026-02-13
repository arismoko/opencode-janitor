// Synced from agent source by sync-agent-renderers. Do not edit.
function formatLabel(value) {
  if (typeof value !== 'string' || !value) return '-';
  return value.toLowerCase().replaceAll('_', ' ');
}

function toRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.length > 0);
}

export function renderFindingEnrichment({ html, payload }) {
  const record = toRecord(payload);
  const principles = toStringArray(record.principles);
  const antiPattern = toRecord(record.antiPattern);
  const recommendedPattern = toRecord(record.recommendedPattern);
  const rewritePlan = toStringArray(record.rewritePlan);
  const tradeoffs = toStringArray(record.tradeoffs);
  const impactScope =
    typeof record.impactScope === 'string' ? record.impactScope : 'LOCAL';

  const antiPatternLabel = formatLabel(antiPattern.label);
  const antiPatternDetail =
    typeof antiPattern.detail === 'string' ? antiPattern.detail : '-';
  const recommendedLabel = formatLabel(recommendedPattern.label);
  const recommendedDetail =
    typeof recommendedPattern.detail === 'string'
      ? recommendedPattern.detail
      : '-';
  const recommendedCustom =
    typeof recommendedPattern.custom === 'string'
      ? recommendedPattern.custom
      : undefined;

  return {
    summaryChips: html`
      <span class="architecture-badge bad">${antiPatternLabel}</span>
      <span class="architecture-badge good">${recommendedLabel}</span>
      <span class=${`architecture-chip scope-${impactScope.toLowerCase()}`}>
        ${formatLabel(impactScope)}
      </span>
    `,
    body: html`
      <div class="architecture-row">
        <div class="architecture-label">Principles</div>
        <div class="architecture-chips">
          ${principles.map(
            (principle) =>
              html`<span class="architecture-chip">${formatLabel(principle)}</span>`,
          )}
        </div>
      </div>

      <div class="architecture-row architecture-grid">
        <div class="architecture-cell">
          <div class="architecture-label">Anti-pattern</div>
          <div class="architecture-badge bad">${antiPatternLabel}</div>
          <p class="architecture-copy">${antiPatternDetail}</p>
        </div>
        <div class="architecture-cell">
          <div class="architecture-label">Recommended pattern</div>
          <div class="architecture-badge good">${recommendedLabel}</div>
          <p class="architecture-copy">${recommendedDetail}</p>
          ${
            recommendedCustom &&
            html`<p class="architecture-copy">custom: ${recommendedCustom}</p>`
          }
        </div>
      </div>

      <div class="architecture-row architecture-grid">
        <div class="architecture-cell">
          <div class="architecture-label">Rewrite plan</div>
          <ul class="architecture-list checklist">
            ${rewritePlan.map((step) => html`<li>${step}</li>`)}
          </ul>
        </div>
        <div class="architecture-cell">
          <div class="architecture-label">Tradeoffs</div>
          <ul class="architecture-list">
            ${tradeoffs.map((tradeoff) => html`<li>${tradeoff}</li>`)}
          </ul>
        </div>
      </div>
    `,
  };
}

export const renderArchitectureV1 = renderFindingEnrichment;
