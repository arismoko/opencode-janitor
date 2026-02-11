import { fmtClock } from '../../helpers.js';
import { SEV } from '../../ui-constants.js';

export function renderReportDetail({
  html,
  selectedReport,
  detail,
  detailMode,
  setDetailMode,
  deleteReport,
  transcript,
}) {
  return html`
    <div class="panel">
      ${
        selectedReport &&
        detail &&
        html`
          <div class="detail-head">
            <div>
              <div>
                <strong>${selectedReport.agent}</strong> ·
                <span class="mono">${(selectedReport.repoPath || '').split('/').pop()}</span>
              </div>
              <div class="muted" style="font-size:11px; margin-top:4px;">
                ${selectedReport.errorMessage || `Session ${selectedReport.sessionId || '-'}`}
              </div>
            </div>
            <div class="detail-actions">
              <button
                class="btn"
                onClick=${() =>
                  setDetailMode(
                    detailMode === 'findings' ? 'session' : 'findings',
                  )}
              >
                ${detailMode === 'findings' ? 'Session' : 'Findings'}
              </button>
              <button class="btn" onClick=${deleteReport}>Delete</button>
            </div>
          </div>
          <div class="detail-scroll">
            ${
              detailMode === 'findings' &&
              html`
                ${
                  detail.findings.length === 0 &&
                  html`<div class="find-card subtle">No findings for this report.</div>`
                }
                ${detail.findings.map(
                  (finding) =>
                    html`
                      <article
                        class="find-card"
                        style=${`border-left-color:${SEV[finding.severity] || '#9c9690'};`}
                      >
                        <div class="row">
                          <strong style=${`color:${SEV[finding.severity] || '#9c9690'};`}
                            >${finding.severity} · ${finding.domain}</strong
                          >
                          <span class="mono subtle">${fmtClock(finding.createdAt)}</span>
                        </div>
                        <p style="margin:8px 0 6px;">${finding.evidence}</p>
                        <div class="mono" style="font-size:10px; color:var(--accent);">
                          ${finding.location}
                        </div>
                        <p class="muted" style="margin:8px 0 0;">${finding.prescription}</p>
                      </article>
                    `,
                )}
              `
            }
            ${
              detailMode === 'session' &&
              html`<pre class="transcript">${
                transcript || 'No session transcript available yet.'
              }</pre>`
            }
          </div>
        `
      }
      ${
        (!selectedReport || !detail) &&
        html`<div class="detail-head muted">Select a report to view details.</div>`
      }
    </div>
  `;
}
