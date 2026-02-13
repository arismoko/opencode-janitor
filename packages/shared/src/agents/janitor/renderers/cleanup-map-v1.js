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

const EFFORT_INFO = {
  TRIVIAL: { label: 'trivial', segments: 1 },
  SMALL: { label: 'small', segments: 2 },
  MEDIUM: { label: 'medium', segments: 3 },
};

const ACTION_ICONS = {
  DELETE: '\u2716',
  EXTRACT: '\u2197',
  INLINE: '\u2199',
  MERGE: '\u21C4',
  REPLACE: '\u21BB',
  SIMPLIFY: '\u2261',
  OTHER: '\u2022',
};

export function renderFindingEnrichment({ html, payload }) {
  const record = toRecord(payload);
  const action = typeof record.action === 'string' ? record.action : 'OTHER';
  const effort = typeof record.effort === 'string' ? record.effort : 'SMALL';
  const linesAffected =
    typeof record.linesAffected === 'number' ? record.linesAffected : 0;
  const targets = toStringArray(record.targets);
  const safetyNote =
    typeof record.safetyNote === 'string' ? record.safetyNote : '';

  const effortInfo = EFFORT_INFO[effort] || EFFORT_INFO.SMALL;
  const actionIcon = ACTION_ICONS[action] || ACTION_ICONS.OTHER;

  const effortSegments = [1, 2, 3].map(
    (seg) =>
      html`<span
        class=${`janitor-effort-seg ${seg <= effortInfo.segments ? `active level-${effortInfo.segments}` : ''}`}
      ></span>`,
  );

  return {
    summaryChips: html`
      <span class="janitor-chip action"
        ><span class="janitor-action-icon">${actionIcon}</span>
        ${formatLabel(action)}</span
      >
      <span class="janitor-chip effort">${effortInfo.label}</span>
      ${
        linesAffected > 0 &&
        html`<span class="janitor-chip lines"
        >${linesAffected}\u2009ln</span
      >`
      }
    `,
    body: html`
      <div class="janitor-plan">
        <div class="janitor-plan-header">
          <div class="janitor-plan-cell">
            <div class="janitor-plan-label">Action</div>
            <div class="janitor-chip action lg">
              <span class="janitor-action-icon">${actionIcon}</span>
              ${formatLabel(action)}
            </div>
          </div>
          <div class="janitor-plan-cell">
            <div class="janitor-plan-label">Effort</div>
            <div class="janitor-effort-gauge">
              ${effortSegments}
              <span class="janitor-effort-label">${effortInfo.label}</span>
            </div>
          </div>
          <div class="janitor-plan-cell">
            <div class="janitor-plan-label">Lines affected</div>
            <div class="janitor-lines-counter">
              <span class="janitor-lines-number">${linesAffected}</span>
            </div>
          </div>
        </div>

        ${
          targets.length > 0 &&
          html`
          <div class="janitor-plan-section">
            <div class="janitor-plan-label">Targets</div>
            <div class="janitor-target-list">
              ${targets.map(
                (t) => html`<code class="janitor-target-item">${t}</code>`,
              )}
            </div>
          </div>
        `
        }
        ${
          safetyNote &&
          html`
          <div class="janitor-safety">
            <div class="janitor-safety-icon">\u2713</div>
            <div class="janitor-safety-text">${safetyNote}</div>
          </div>
        `
        }
      </div>
    `,
  };
}

export const renderCleanupMapV1 = renderFindingEnrichment;
