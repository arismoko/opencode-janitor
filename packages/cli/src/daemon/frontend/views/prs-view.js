import { renderPrActionsDock } from './prs/pr-actions-dock.js';
import { renderPrDetail } from './prs/pr-detail.js';
import { renderPrList } from './prs/pr-list.js';

export function renderPrsView({
  html,
  selectedRepo,
  prs,
  onSelectPr,
  onBucketChange,
  onQueryInput,
  onMerge,
  onAddComment,
  onRequestReviewers,
  onReply,
}) {
  if (!selectedRepo) {
    return html`
      <section class="panel pr-detail">
        <div class="detail-head muted">Select a repository to browse pull requests.</div>
      </section>
    `;
  }

  return html`
    <section class="prs-layout">
      ${renderPrList({
        html,
        selectedRepo,
        list: prs.list,
        selectedPrNumber: prs.selectedPrNumber,
        listLoading: prs.listLoading,
        bucket: prs.bucket,
        query: prs.query,
        setBucket: onBucketChange,
        setQuery: onQueryInput,
        setSelectedPrNumber: onSelectPr,
      })}
      <section class="panel pr-detail">
        ${renderPrDetail({
          html,
          selectedRepo,
          selectedSummary: prs.selectedSummary,
          detail: prs.detail,
          detailLoading: prs.detailLoading,
          onReply,
        })}
      </section>
      <section class="panel pr-action-dock">
        ${renderPrActionsDock({
          html,
          selectedPrNumber: prs.selectedPrNumber,
          detail: prs.detail,
          onMerge,
          onAddComment,
          onRequestReviewers,
        })}
      </section>
    </section>
  `;
}
