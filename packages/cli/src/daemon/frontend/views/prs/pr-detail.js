import { renderPrThread } from './pr-thread.js';

export function renderPrDetail({
  html,
  selectedRepo,
  selectedSummary,
  detail,
  detailLoading,
  onReply,
}) {
  if (!selectedSummary) {
    return html`<div class="detail-head muted">Select a pull request to inspect details.</div>`;
  }

  return html`
    <div class="detail-head">
      <div>
        <div>
          <strong>#${selectedSummary.number}</strong>
          <span>${selectedSummary.title}</span>
        </div>
        <div class="muted" style="font-size:11px; margin-top:4px;">
          ${(selectedRepo.path || '').split('/').pop()} · @${selectedSummary.authorLogin || 'unknown'}
        </div>
      </div>
      <div class="detail-actions">
        <a class="btn" href=${selectedSummary.url} target="_blank" rel="noreferrer">Open PR</a>
      </div>
    </div>
    <div class="detail-scroll">
      ${detailLoading && html`<div class="list-item muted">Loading PR detail...</div>`}
      ${
        !detailLoading &&
        detail &&
        html`
          <section class="pr-detail-body">
            <div class="meta-grid" style="grid-template-columns: repeat(5, minmax(0, 1fr));">
              <div class="meta-item"><div class="label">State</div><div class="value">${detail.state}</div></div>
              <div class="meta-item"><div class="label">Review</div><div class="value">${detail.reviewDecision || '-'}</div></div>
              <div class="meta-item"><div class="label">Files</div><div class="value">${detail.changedFiles}</div></div>
              <div class="meta-item"><div class="label">Add / Del</div><div class="value">+${detail.additions} / -${detail.deletions}</div></div>
              <div class="meta-item"><div class="label">Branch</div><div class="value">${detail.headRefName}</div></div>
            </div>
            <pre class="transcript">${detail.body || 'No description provided.'}</pre>
            ${renderPrThread({ html, detail, onReply })}
          </section>
        `
      }
    </div>
  `;
}
