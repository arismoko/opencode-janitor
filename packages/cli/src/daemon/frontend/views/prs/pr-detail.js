import { useEffect, useState } from 'https://esm.sh/preact@10.26.2/hooks';
import { fmtAgo } from '../../helpers.js';
import { renderMarkdownContent } from '../../utils/markdown.js';
import { renderPrThread } from './pr-thread.js';

function formatRelative(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? fmtAgo(time) : '-';
}

function renderCommitHistory(html, detail) {
  const commits = Array.isArray(detail?.commitHistory)
    ? detail.commitHistory
    : [];

  return html`
    <section class="pr-commit-history">
      <h3>Commit history</h3>
      ${
        commits.length === 0 &&
        html`<div class="muted">No commit history available from GitHub CLI response.</div>`
      }
      ${commits.map((commit) => {
        const authors =
          Array.isArray(commit.authorLogins) && commit.authorLogins.length > 0
            ? commit.authorLogins.map((author) => `@${author}`).join(', ')
            : '@unknown';
        return html`
          <article class="pr-commit-item">
            <div class="row">
              <strong class="mono">${commit.shortOid || commit.oid.slice(0, 7)}</strong>
              <span class="subtle mono">${formatRelative(commit.authoredDate)}</span>
            </div>
            ${renderMarkdownContent(html, commit.messageHeadline || '(no commit message)')}
            <div class="subtle mono">${authors}</div>
          </article>
        `;
      })}
    </section>
  `;
}

function renderOverview(html, detail) {
  return html`
    <section class="pr-detail-body">
      <div class="meta-grid pr-meta-grid">
        <div class="meta-item"><div class="label">State</div><div class="value">${detail.state}</div></div>
        <div class="meta-item"><div class="label">Review</div><div class="value">${detail.reviewDecision || '-'}</div></div>
        <div class="meta-item"><div class="label">Mergeable</div><div class="value">${detail.mergeable || '-'}</div></div>
        <div class="meta-item"><div class="label">Merge status</div><div class="value">${detail.mergeStateStatus || '-'}</div></div>
        <div class="meta-item"><div class="label">Files</div><div class="value">${detail.changedFiles}</div></div>
        <div class="meta-item"><div class="label">Commits</div><div class="value">${detail.commits}</div></div>
        <div class="meta-item"><div class="label">Add / Del</div><div class="value">+${detail.additions} / -${detail.deletions}</div></div>
        <div class="meta-item"><div class="label">Head / Base</div><div class="value">${detail.headRefName} -> ${detail.baseRefName}</div></div>
      </div>

      <section class="pr-description">
        <h3>Description</h3>
        ${renderMarkdownContent(
          html,
          detail.body || 'No description provided.',
          'markdown-content pr-markdown',
        )}
      </section>
    </section>
  `;
}

function renderChecks(html, detail) {
  return html`
    <section class="pr-commit-history">
      <h3>Checks & merge readiness</h3>
      <div class="pr-check-grid">
        <div class="meta-item"><div class="label">Review decision</div><div class="value">${detail.reviewDecision || '-'}</div></div>
        <div class="meta-item"><div class="label">Merge state</div><div class="value">${detail.mergeStateStatus || '-'}</div></div>
        <div class="meta-item"><div class="label">Merged</div><div class="value">${detail.merged ? 'Yes' : 'No'}</div></div>
      </div>
      <div class="muted">
        Detailed check runs are not included in v1 yet. Use Open PR for full checks.
      </div>
    </section>
  `;
}

function PrDetailPanel({
  html,
  selectedRepo,
  selectedSummary,
  detail,
  detailLoading,
  onAddComment,
  onReply,
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const [commentBody, setCommentBody] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    setActiveTab('overview');
    setCommentBody('');
  }, [selectedSummary?.number]);

  const submitComment = async (event) => {
    event.preventDefault();
    const body = commentBody.trim();
    if (!body || submittingComment || typeof onAddComment !== 'function')
      return;
    setSubmittingComment(true);
    try {
      await onAddComment(body);
      setCommentBody('');
    } finally {
      setSubmittingComment(false);
    }
  };

  if (!selectedSummary) {
    return html`<div class="detail-head muted">Select a pull request to inspect details.</div>`;
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'commits', label: 'Commits' },
    { id: 'conversation', label: 'Conversation' },
    { id: 'checks', label: 'Checks' },
  ];

  return html`
    <div class="detail-head pr-detail-head">
      <div>
        <div class="pr-title-row">
          <strong>#${selectedSummary.number}</strong>
          <span>${selectedSummary.title}</span>
        </div>
        <div class="muted" style="font-size:11px; margin-top:4px;">
          ${(selectedRepo.path || '').split('/').pop()} | @${selectedSummary.authorLogin || 'unknown'}
        </div>
      </div>
      <div class="detail-actions">
        <a class="btn" href=${selectedSummary.url} target="_blank" rel="noreferrer">Open PR</a>
      </div>
    </div>
    <div class="pr-detail-tabs" role="tablist" aria-label="Pull request detail sections">
      ${tabs.map(
        (tab) => html`
          <button
            type="button"
            class=${`pr-detail-tab ${activeTab === tab.id ? 'active' : ''}`}
            role="tab"
            aria-selected=${activeTab === tab.id}
            onClick=${() => setActiveTab(tab.id)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
    <div class="detail-scroll">
      ${detailLoading && html`<div class="list-item muted">Loading PR detail...</div>`}
      ${
        !detailLoading &&
        detail &&
        html`
          ${activeTab === 'overview' ? renderOverview(html, detail) : null}
          ${activeTab === 'commits' ? renderCommitHistory(html, detail) : null}
          ${activeTab === 'conversation' ? renderPrThread({ html, detail, onReply }) : null}
          ${activeTab === 'checks' ? renderChecks(html, detail) : null}
        `
      }
    </div>
    ${
      !detailLoading &&
      detail &&
      html`
        <form class="pr-detail-composer" onSubmit=${submitComment}>
          <label>
            Quick PR comment
            <textarea
              class="pr-input"
              rows="3"
              placeholder="Leave a quick note on this PR"
              value=${commentBody}
              onInput=${(event) => setCommentBody(event.target.value)}
            ></textarea>
          </label>
          <button class="btn" type="submit" disabled=${submittingComment || !commentBody.trim()}>
            Comment
          </button>
        </form>
      `
    }
  `;
}

export function renderPrDetail(props) {
  const { html } = props;
  return html`
    <${PrDetailPanel}
      html=${props.html}
      selectedRepo=${props.selectedRepo}
      selectedSummary=${props.selectedSummary}
      detail=${props.detail}
      detailLoading=${props.detailLoading}
      onAddComment=${props.onAddComment}
      onReply=${props.onReply}
    />
  `;
}
