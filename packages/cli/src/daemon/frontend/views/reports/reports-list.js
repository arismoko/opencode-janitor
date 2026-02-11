import { BADGE, SEV } from '../../constants.js';
import { fmtAgo, severityDots } from '../../helpers.js';

export function renderReportsList({
  html,
  filteredReports,
  selectedReport,
  setSelectedReportId,
}) {
  return html`
    <div class="panel list-scroll">
      ${
        filteredReports.length === 0 &&
        html`<div class="list-item muted">No reports yet for this repo.</div>`
      }
      ${filteredReports.map((report) => {
        const [fg, bg] = BADGE[report.status] || [
          '#9c9690',
          'rgba(156,150,144,.12)',
        ];
        const dots = severityDots(report);
        return html`
          <div
            class=${`list-item ${selectedReport?.id === report.id ? 'active' : ''}`}
            onClick=${() => setSelectedReportId(report.id)}
          >
            <div class="row">
              <strong>${report.agent}</strong>
              <span
                class="badge"
                style=${`color:${fg};background:${bg};border-color:${fg}44`}
                >${report.status}</span
              >
            </div>
            <div class="row muted" style="margin-top:4px; font-size:12px;">
              <span>${(report.repoPath || '').split('/').pop()}</span>
              <span class="mono">${fmtAgo(report.finishedAt || report.startedAt || 0)}</span>
            </div>
            <div
              class="severity"
              style="margin-top:8px;"
              title=${`P0 ${report.p0Count} / P1 ${report.p1Count} / P2 ${report.p2Count} / P3 ${report.p3Count}`}
            >
              ${dots.map(
                (severity) =>
                  html`<span class="sev-dot" style=${`background:${SEV[severity]};`}></span>`,
              )}
              ${
                report.findingsCount > dots.length &&
                html`<span class="subtle mono" style="font-size:11px;"
                  >+${report.findingsCount - dots.length}</span
                >`
              }
            </div>
          </div>
        `;
      })}
    </div>
  `;
}
