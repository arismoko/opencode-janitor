// Synced from agent source by sync-agent-renderers. Do not edit.
function formatLabel(value) {
  if (typeof value !== 'string' || !value) return '-';
  return value.toLowerCase().replaceAll('_', ' ');
}

function toRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

const STALENESS_INFO = {
  CURRENT: { label: 'current', css: 'current' },
  STALE: { label: 'stale', css: 'stale' },
  OBSOLETE: { label: 'obsolete', css: 'obsolete' },
  MISSING: { label: 'missing', css: 'missing' },
};

export function renderFindingEnrichment({ html, payload }) {
  const record = toRecord(payload);
  const docType = typeof record.docType === 'string' ? record.docType : 'OTHER';
  const staleness =
    typeof record.staleness === 'string' ? record.staleness : 'STALE';
  const docSource =
    typeof record.docSource === 'string' ? record.docSource : '-';
  const codeSource =
    typeof record.codeSource === 'string' ? record.codeSource : '-';
  const discrepancy =
    typeof record.discrepancy === 'string' ? record.discrepancy : '';

  const stalenessInfo = STALENESS_INFO[staleness] || STALENESS_INFO.STALE;

  return {
    summaryChips: html`
      <span class="scribe-chip doc-type">${formatLabel(docType)}</span>
      <span class=${`scribe-chip staleness-${stalenessInfo.css}`}
        >${stalenessInfo.label}</span
      >
    `,
    body: html`
      <div class="scribe-alignment">
        <div class="scribe-alignment-header">
          <div class="scribe-alignment-cell">
            <div class="scribe-alignment-label">Doc type</div>
            <div class="scribe-chip doc-type lg">${formatLabel(docType)}</div>
          </div>
          <div class="scribe-alignment-cell">
            <div class="scribe-alignment-label">Staleness</div>
            <div class=${`scribe-chip staleness-${stalenessInfo.css} lg`}>
              ${stalenessInfo.label}
            </div>
          </div>
        </div>

        <div class="scribe-trace">
          <div class="scribe-trace-node doc">
            <div class="scribe-trace-label">Doc source</div>
            <code class="scribe-trace-path">${docSource}</code>
          </div>
          <div class="scribe-trace-connector">
            <span class="scribe-trace-arrow">\u2260</span>
          </div>
          <div class="scribe-trace-node code">
            <div class="scribe-trace-label">Code source</div>
            <code class="scribe-trace-path">${codeSource}</code>
          </div>
        </div>

        ${
          discrepancy &&
          html`
          <div class="scribe-discrepancy">
            <div class="scribe-discrepancy-icon">\u26A0</div>
            <div class="scribe-discrepancy-text">${discrepancy}</div>
          </div>
        `
        }
      </div>
    `,
  };
}

export const renderDocAlignmentV1 = renderFindingEnrichment;
