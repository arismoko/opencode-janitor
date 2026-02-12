import { fmtAgo } from '../../helpers.js';

const BUCKET_OPTIONS = [
  { value: 'all-open', label: 'All open' },
  { value: 'review-requested', label: 'Review requested' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'created-by-me', label: 'Created by me' },
  { value: 'mentioned', label: 'Mentioned' },
];

function renderReviewerPills(html, reviewers) {
  if (!Array.isArray(reviewers) || reviewers.length === 0) {
    return html`<span class="subtle">No requested reviewers</span>`;
  }

  return html`
    <span class="pr-reviewers">
      ${reviewers.slice(0, 3).map((reviewer) => html`<span>@${reviewer}</span>`)}
      ${
        reviewers.length > 3 &&
        html`<span class="subtle mono">+${reviewers.length - 3}</span>`
      }
    </span>
  `;
}

export function renderPrList({
  html,
  selectedRepo,
  list,
  selectedPrNumber,
  listLoading,
  bucket,
  query,
  setBucket,
  setQuery,
  setSelectedPrNumber,
}) {
  return html`
    <section class="panel">
      <div class="toolbar">
        <strong>PRs · ${(selectedRepo.path || '').split('/').pop()}</strong>
      </div>
      <div class="pr-filters">
        <label>
          Bucket
          <select
            class="pr-select"
            value=${bucket}
            onChange=${(event) => setBucket(event.target.value)}
          >
            ${BUCKET_OPTIONS.map(
              (option) =>
                html`<option value=${option.value}>${option.label}</option>`,
            )}
          </select>
        </label>
        <label>
          Search
          <input
            class="pr-input"
            type="text"
            placeholder="label:bug author:alice"
            value=${query}
            onInput=${(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div class="list-scroll">
        ${
          listLoading &&
          html`<div class="list-item muted" role="status">Loading pull requests...</div>`
        }
        ${
          !listLoading &&
          list.length === 0 &&
          html`<div class="list-item muted">No pull requests match this filter.</div>`
        }
        ${list.map((pr) => {
          const isActive = selectedPrNumber === pr.number;
          return html`
            <button
              class=${`pr-list-item ${isActive ? 'active' : ''}`}
              onClick=${() => setSelectedPrNumber(pr.number)}
            >
              <div class="row">
                <strong>#${pr.number} ${pr.title}</strong>
                <span class="badge">${pr.state}</span>
              </div>
              <div class="row muted" style="margin-top:6px;">
                <span>@${pr.authorLogin || 'unknown'}</span>
                <span class="mono">${fmtAgo(new Date(pr.updatedAt).getTime())}</span>
              </div>
              <div class="row subtle" style="margin-top:6px;">
                <span>${pr.reviewDecision || 'NO_DECISION'}</span>
                ${renderReviewerPills(html, pr.requestedReviewers || [])}
              </div>
            </button>
          `;
        })}
      </div>
    </section>
  `;
}
