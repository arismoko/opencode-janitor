import { fmtClock } from '../helpers.js';

function activityColor(level) {
  if (level === 'error') return 'var(--error)';
  if (level === 'warn') return 'var(--warn)';
  if (level === 'info') return '#6FA0BE';
  return 'var(--text-tertiary)';
}

export function renderActivityView({
  html,
  filteredActivity,
  clearActivityLog,
  setActivityFilter,
}) {
  return html`
    <section class="panel activity-window">
      <div class="toolbar">
        <strong>Activity Log</strong>
        <div class="detail-actions">
          <button class="btn btn-danger" onClick=${clearActivityLog}>Clear</button>
          <button class="btn" onClick=${() => setActivityFilter('all')}>All</button>
          <button class="btn" onClick=${() => setActivityFilter('info+')}>Info+</button>
          <button class="btn" onClick=${() => setActivityFilter('warn+')}>Warn+</button>
          <button class="btn" onClick=${() => setActivityFilter('error')}>Error</button>
        </div>
      </div>
      <div class="activity-scroll">
        ${
          filteredActivity.length === 0 &&
          html`<div class="activity-line muted">No activity events yet.</div>`
        }
        ${filteredActivity.map((event) => {
          const color = activityColor(event.level);
          return html`
            <div class="activity-line">
              <span style=${`color:${color};`}
                >${String(event.level).toUpperCase().padEnd(5)}</span
              >
              <span class="subtle"> ${fmtClock(event.ts)} </span>
              <span style="color:var(--accent)">${event.topic}</span>
              <span class="muted"> ${event.message}</span>
            </div>
          `;
        })}
      </div>
    </section>
  `;
}
