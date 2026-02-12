import { useState } from 'https://esm.sh/preact@10.26.2/hooks';

function PrActionsDock({
  html,
  selectedPrNumber,
  detail,
  onMerge,
  onAddComment,
  onRequestReviewers,
}) {
  const [mergeMethod, setMergeMethod] = useState('merge');
  const [commentBody, setCommentBody] = useState('');
  const [reviewersInput, setReviewersInput] = useState('');
  const [busy, setBusy] = useState(false);

  const hasSelection = Boolean(selectedPrNumber);

  const submitMerge = async () => {
    if (!hasSelection || busy) return;
    setBusy(true);
    try {
      await onMerge(mergeMethod);
    } finally {
      setBusy(false);
    }
  };

  const submitComment = async (event) => {
    event.preventDefault();
    const body = commentBody.trim();
    if (!hasSelection || !body || busy) return;
    setBusy(true);
    try {
      await onAddComment(body);
      setCommentBody('');
    } finally {
      setBusy(false);
    }
  };

  const submitReviewers = async (event) => {
    event.preventDefault();
    if (!hasSelection || busy) return;
    const reviewers = reviewersInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (reviewers.length === 0) return;

    setBusy(true);
    try {
      await onRequestReviewers(reviewers);
      setReviewersInput('');
    } finally {
      setBusy(false);
    }
  };

  return html`
    <div class="toolbar"><strong>Actions</strong></div>
    <div class="pr-actions-body">
      ${
        !hasSelection &&
        html`<div class="muted">Select a PR to run actions.</div>`
      }
      ${
        hasSelection &&
        html`
          <div class="mono subtle">PR #${selectedPrNumber}</div>
          <label>
            Merge method
            <select
              class="pr-select"
              value=${mergeMethod}
              onChange=${(event) => setMergeMethod(event.target.value)}
            >
              <option value="merge">Merge commit</option>
              <option value="squash">Squash</option>
              <option value="rebase">Rebase</option>
            </select>
          </label>
          <button
            class="btn"
            disabled=${busy || detail?.merged}
            onClick=${submitMerge}
          >
            ${detail?.merged ? 'Already merged' : 'Merge PR'}
          </button>

          <form class="pr-inline-form" onSubmit=${submitComment}>
            <label>
              Top-level comment
              <textarea
                class="pr-input"
                rows="4"
                placeholder="Add a top-level PR comment"
                value=${commentBody}
                onInput=${(event) => setCommentBody(event.target.value)}
              ></textarea>
            </label>
            <button class="btn" type="submit" disabled=${busy || !commentBody.trim()}>
              Comment
            </button>
          </form>

          <form class="pr-inline-form" onSubmit=${submitReviewers}>
            <label>
              Request reviewers
              <input
                class="pr-input"
                type="text"
                placeholder="alice,bob"
                value=${reviewersInput}
                onInput=${(event) => setReviewersInput(event.target.value)}
              />
            </label>
            <button
              class="btn"
              type="submit"
              disabled=${busy || !reviewersInput.trim()}
            >
              Request
            </button>
          </form>
        `
      }
    </div>
  `;
}

export function renderPrActionsDock(props) {
  const { html } = props;
  return html`
    <${PrActionsDock}
      html=${props.html}
      selectedPrNumber=${props.selectedPrNumber}
      detail=${props.detail}
      onMerge=${props.onMerge}
      onAddComment=${props.onAddComment}
      onRequestReviewers=${props.onRequestReviewers}
    />
  `;
}
