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

const CONFIDENCE_LEVELS = {
  CERTAIN: { label: 'certain', level: 4 },
  HIGH: { label: 'high', level: 3 },
  MEDIUM: { label: 'medium', level: 2 },
  SPECULATIVE: { label: 'speculative', level: 1 },
};

const BLAST_RADIUS_MAP = {
  ISOLATED: { label: 'isolated', css: 'isolated' },
  MODULE: { label: 'module', css: 'module' },
  SYSTEM_WIDE: { label: 'system-wide', css: 'system-wide' },
};

export function renderFindingEnrichment({ html, payload }) {
  const record = toRecord(payload);
  const category =
    typeof record.category === 'string' ? record.category : 'OTHER';
  const failureMode =
    typeof record.failureMode === 'string' ? record.failureMode : 'OTHER';
  const blastRadius =
    typeof record.blastRadius === 'string' ? record.blastRadius : 'ISOLATED';
  const confidence =
    typeof record.confidence === 'string' ? record.confidence : 'MEDIUM';
  const triggerConditions = toStringArray(record.triggerConditions);
  const affectedPaths = toStringArray(record.affectedPaths);

  const confidenceInfo =
    CONFIDENCE_LEVELS[confidence] || CONFIDENCE_LEVELS.MEDIUM;
  const blastInfo = BLAST_RADIUS_MAP[blastRadius] || BLAST_RADIUS_MAP.ISOLATED;

  const confidenceSegments = [1, 2, 3, 4].map(
    (seg) =>
      html`<span
        class=${`hunter-gauge-seg ${seg <= confidenceInfo.level ? `active level-${confidenceInfo.level}` : ''}`}
      ></span>`,
  );

  return {
    summaryChips: html`
      <span class="hunter-chip category">${formatLabel(category)}</span>
      <span class=${`hunter-chip failure-mode`}>${formatLabel(failureMode)}</span>
      <span class=${`hunter-chip blast-${blastInfo.css}`}>${blastInfo.label}</span>
    `,
    body: html`
      <div class="hunter-diag">
        <div class="hunter-diag-header">
          <div class="hunter-diag-cell">
            <div class="hunter-diag-label">Category</div>
            <div class="hunter-chip category lg">${formatLabel(category)}</div>
          </div>
          <div class="hunter-diag-cell">
            <div class="hunter-diag-label">Failure mode</div>
            <div class="hunter-chip failure-mode lg">
              ${formatLabel(failureMode)}
            </div>
          </div>
          <div class="hunter-diag-cell">
            <div class="hunter-diag-label">Blast radius</div>
            <div class=${`hunter-chip blast-${blastInfo.css} lg`}>
              ${blastInfo.label}
            </div>
          </div>
          <div class="hunter-diag-cell">
            <div class="hunter-diag-label">Confidence</div>
            <div class="hunter-gauge">
              ${confidenceSegments}
              <span class="hunter-gauge-label">${confidenceInfo.label}</span>
            </div>
          </div>
        </div>

        ${
          triggerConditions.length > 0 &&
          html`
          <div class="hunter-diag-section">
            <div class="hunter-diag-label">Trigger conditions</div>
            <ol class="hunter-trigger-list">
              ${triggerConditions.map(
                (step) => html`<li class="hunter-trigger-item">${step}</li>`,
              )}
            </ol>
          </div>
        `
        }
        ${
          affectedPaths.length > 0 &&
          html`
          <div class="hunter-diag-section">
            <div class="hunter-diag-label">Propagation paths</div>
            <div class="hunter-path-flow">
              ${affectedPaths.map(
                (p, i) => html`
                  ${
                    i > 0 &&
                    html`<span class="hunter-path-arrow" aria-hidden="true"
                    >&darr;</span
                  >`
                  }
                  <div class="hunter-path-node">
                    <code class="hunter-path-code">${p}</code>
                  </div>
                `,
              )}
            </div>
          </div>
        `
        }
      </div>
    `,
  };
}

export const renderBugAnalysisV1 = renderFindingEnrichment;
