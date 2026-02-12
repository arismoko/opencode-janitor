import { useMemo, useState } from 'https://esm.sh/preact@10.26.2/hooks';
import { fmtClock } from '../../helpers.js';
import { renderMarkdownContent } from '../../utils/markdown.js';

function byDateAscending(left, right) {
  return (
    new Date(left.createdAt || left.updatedAt || 0).getTime() -
    new Date(right.createdAt || right.updatedAt || 0).getTime()
  );
}

function flattenConversation(detail) {
  const issueComments = Array.isArray(detail?.issueComments)
    ? detail.issueComments
    : [];
  const reviewComments = Array.isArray(detail?.reviewComments)
    ? detail.reviewComments
    : [];
  const topLevelReview = reviewComments.filter((item) => !item.inReplyToId);

  return [
    ...issueComments.map((item) => ({
      kind: 'issue',
      id: item.id,
      authorLogin: item.authorLogin,
      body: item.body,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      url: item.url,
      path: null,
      line: null,
      replies: [],
    })),
    ...topLevelReview.map((item) => ({
      kind: 'review',
      id: item.id,
      authorLogin: item.authorLogin,
      body: item.body,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      url: item.url,
      path: item.path,
      line: item.line,
      replies: reviewComments
        .filter((candidate) => candidate.inReplyToId === item.id)
        .sort(byDateAscending),
    })),
  ].sort(byDateAscending);
}

function ThreadReplyForm({ html, commentId, onReply }) {
  const [replyBody, setReplyBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const body = replyBody.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      await onReply(commentId, body);
      setReplyBody('');
    } finally {
      setSubmitting(false);
    }
  };

  return html`
    <form class="pr-inline-form" onSubmit=${submit}>
      <input
        class="pr-input"
        type="text"
        value=${replyBody}
        placeholder="Reply to review comment"
        onInput=${(event) => setReplyBody(event.target.value)}
      />
      <button class="btn" type="submit" disabled=${submitting || !replyBody.trim()}>
        Reply
      </button>
    </form>
  `;
}

function renderReply(html, reply) {
  return html`
    <article class="pr-thread-reply">
      <div class="row">
        <strong>@${reply.authorLogin || 'unknown'}</strong>
        <span class="subtle mono"
          >${fmtClock(new Date(reply.updatedAt || reply.createdAt || 0).getTime())}</span
        >
      </div>
      ${renderMarkdownContent(html, reply.body || '(no content)')}
    </article>
  `;
}

export function renderPrThread({ html, detail, onReply }) {
  const conversation = useMemo(() => flattenConversation(detail), [detail]);

  if (conversation.length === 0) {
    return html`
      <section class="pr-thread">
        <h3>Conversation</h3>
        <div class="muted">No issue or review comments yet.</div>
      </section>
    `;
  }

  return html`
    <section class="pr-thread">
      <h3>Conversation</h3>
      ${conversation.map((item) => {
        const timestamp = new Date(
          item.updatedAt || item.createdAt || 0,
        ).getTime();
        return html`
          <article class="pr-thread-item ${item.kind}">
            <div class="row">
              <div class="pr-thread-headline">
                <span class="pr-thread-kind">${item.kind === 'issue' ? 'Issue' : 'Review'}</span>
                <strong>@${item.authorLogin || 'unknown'}</strong>
              </div>
              <span class="subtle mono">${fmtClock(timestamp)}</span>
            </div>
            ${
              item.path &&
              html`<div class="subtle mono">${item.path}:${item.line || '-'}</div>`
            }
            ${renderMarkdownContent(html, item.body || '(no content)')}
            ${
              item.url &&
              html`
                <a href=${item.url} target="_blank" rel="noreferrer" class="subtle mono">
                  Open comment
                </a>
              `
            }
            ${
              item.kind === 'review' &&
              typeof onReply === 'function' &&
              html`<${ThreadReplyForm} html=${html} commentId=${item.id} onReply=${onReply} />`
            }
            ${
              item.replies.length > 0 &&
              html`
                <div class="pr-thread-replies">
                  ${item.replies.map((reply) => renderReply(html, reply))}
                </div>
              `
            }
          </article>
        `;
      })}
    </section>
  `;
}
