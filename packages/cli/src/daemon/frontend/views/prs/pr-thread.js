import { useState } from 'https://esm.sh/preact@10.26.2/hooks';
import { fmtClock } from '../../helpers.js';

function ThreadItem({ html, comment, children, onReply }) {
  const [replyBody, setReplyBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const body = replyBody.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      await onReply(comment.id, body);
      setReplyBody('');
    } finally {
      setSubmitting(false);
    }
  };

  return html`
    <article class="pr-thread-item">
      <div class="row">
        <strong>@${comment.authorLogin || 'unknown'}</strong>
        <span class="subtle mono">${fmtClock(new Date(comment.updatedAt).getTime())}</span>
      </div>
      ${comment.path && html`<div class="subtle mono">${comment.path}:${comment.line || '-'}</div>`}
      <p>${comment.body || '(no content)'}</p>
      ${
        typeof onReply === 'function' &&
        html`
          <form class="pr-inline-form" onSubmit=${submit}>
            <input
              class="pr-input"
              type="text"
              value=${replyBody}
              placeholder="Reply to this review comment"
              onInput=${(event) => setReplyBody(event.target.value)}
            />
            <button class="btn" type="submit" disabled=${submitting || !replyBody.trim()}>
              Reply
            </button>
          </form>
        `
      }
      ${children}
    </article>
  `;
}

export function renderPrThread({ html, detail, onReply }) {
  const issueComments = Array.isArray(detail?.issueComments)
    ? detail.issueComments
    : [];
  const reviewComments = Array.isArray(detail?.reviewComments)
    ? detail.reviewComments
    : [];

  const topLevelReviewComments = reviewComments.filter(
    (comment) => !comment.inReplyToId,
  );

  return html`
    <section class="pr-thread">
      <h3>Issue comments</h3>
      ${
        issueComments.length === 0 &&
        html`<div class="muted">No issue comments on this PR.</div>`
      }
      ${issueComments.map(
        (comment) => html`
          <article class="pr-thread-item">
            <div class="row">
              <strong>@${comment.authorLogin || 'unknown'}</strong>
              <span class="subtle mono"
                >${fmtClock(new Date(comment.updatedAt).getTime())}</span
              >
            </div>
            <p>${comment.body || '(no content)'}</p>
          </article>
        `,
      )}

      <h3>Review comments</h3>
      ${
        topLevelReviewComments.length === 0 &&
        html`<div class="muted">No review comments on this PR.</div>`
      }
      ${topLevelReviewComments.map((comment) => {
        const replies = reviewComments.filter(
          (candidate) => candidate.inReplyToId === comment.id,
        );
        return html`
          <${ThreadItem} html=${html} comment=${comment} onReply=${onReply}>
            ${
              replies.length > 0 &&
              html`
                <div class="pr-thread-replies">
                  ${replies.map(
                    (reply) => html`
                      <article class="pr-thread-item">
                        <div class="row">
                          <strong>@${reply.authorLogin || 'unknown'}</strong>
                          <span class="subtle mono"
                            >${fmtClock(new Date(reply.updatedAt).getTime())}</span
                          >
                        </div>
                        <p>${reply.body || '(no content)'}</p>
                      </article>
                    `,
                  )}
                </div>
              `
            }
          </${ThreadItem}>
        `;
      })}
    </section>
  `;
}
