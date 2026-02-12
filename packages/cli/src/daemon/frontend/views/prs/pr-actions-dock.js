import { useMemo, useState } from 'https://esm.sh/preact@10.26.2/hooks';

function supportedPrAgents(capabilities) {
  const agents = Array.isArray(capabilities?.agents) ? capabilities.agents : [];
  return agents.filter(
    (agent) =>
      Array.isArray(agent.manualScopes) && agent.manualScopes.includes('pr'),
  );
}

function PrActionsDock({
  html,
  selectedPrNumber,
  detail,
  capabilities,
  onMerge,
  onAddComment,
  onRequestReviewers,
  onTriggerReview,
}) {
  const [mergeMethod, setMergeMethod] = useState('merge');
  const [commentBody, setCommentBody] = useState('');
  const [reviewersInput, setReviewersInput] = useState('');
  const [reviewAgent, setReviewAgent] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewFocusPath, setReviewFocusPath] = useState('');
  const [busy, setBusy] = useState(false);

  const hasSelection = Boolean(selectedPrNumber);
  const prAgents = useMemo(
    () => supportedPrAgents(capabilities),
    [capabilities],
  );
  const activeReviewAgent =
    reviewAgent || (prAgents.length > 0 ? prAgents[0].id : '');

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

  const submitTriggerReview = async (event) => {
    event.preventDefault();
    if (!hasSelection || busy || !activeReviewAgent) return;
    setBusy(true);
    try {
      await onTriggerReview({
        agent: activeReviewAgent,
        note: reviewNote,
        focusPath: reviewFocusPath,
      });
      setReviewNote('');
      setReviewFocusPath('');
    } finally {
      setBusy(false);
    }
  };

  return html`
    <div class="toolbar"><strong>Actions</strong></div>
    <div class="pr-actions-body">
      ${!hasSelection && html`<div class="muted">Select a PR to run actions.</div>`}
      ${
        hasSelection &&
        html`
          <div class="mono subtle">PR #${selectedPrNumber}</div>

          <section class="pr-action-group">
            <h3>Comments</h3>
            <form class="pr-inline-form" onSubmit=${submitComment}>
              <label>
                Top-level comment
                <textarea
                  class="pr-input"
                  rows="3"
                  placeholder="Add a top-level PR comment"
                  value=${commentBody}
                  onInput=${(event) => setCommentBody(event.target.value)}
                ></textarea>
              </label>
              <button class="btn" type="submit" disabled=${busy || !commentBody.trim()}>
                Comment
              </button>
            </form>
          </section>

          <section class="pr-action-group">
            <h3>Trigger agent review</h3>
            ${
              prAgents.length === 0 &&
              html`
                <div class="muted">
                  No agents support PR-scope manual reviews.
                </div>
              `
            }
            ${
              prAgents.length > 0 &&
              html`
                <form class="pr-inline-form" onSubmit=${submitTriggerReview}>
                  <label>
                    Agent
                    <select
                      class="pr-select"
                      value=${activeReviewAgent}
                      onChange=${(event) => setReviewAgent(event.target.value)}
                    >
                      ${prAgents.map(
                        (agent) =>
                          html`<option value=${agent.id}>${agent.label}</option>`,
                      )}
                    </select>
                  </label>
                  <details class="pr-action-inline-options">
                    <summary>Advanced context (optional)</summary>
                    <label>
                      Note
                      <textarea
                        class="pr-input"
                        rows="2"
                        placeholder="Review for regression and edge cases"
                        value=${reviewNote}
                        onInput=${(event) => setReviewNote(event.target.value)}
                      ></textarea>
                    </label>
                    <label>
                      Focus path
                      <input
                        class="pr-input"
                        type="text"
                        placeholder="src/features/payments"
                        value=${reviewFocusPath}
                        onInput=${(event) => setReviewFocusPath(event.target.value)}
                      />
                    </label>
                  </details>
                  <button class="btn" type="submit" disabled=${busy || !activeReviewAgent}>
                    Trigger review
                  </button>
                </form>
              `
            }
          </section>

          <section class="pr-action-group">
            <h3>Merge</h3>
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
          </section>

          <details class="pr-action-group pr-action-secondary">
            <summary>Human handoff (optional)</summary>
            <form class="pr-inline-form" onSubmit=${submitReviewers}>
              <label>
                Request human reviewers
                <input
                  class="pr-input"
                  type="text"
                  placeholder="alice,bob"
                  value=${reviewersInput}
                  onInput=${(event) => setReviewersInput(event.target.value)}
                />
              </label>
              <button class="btn" type="submit" disabled=${busy || !reviewersInput.trim()}>
                Request reviewers
              </button>
            </form>
          </details>
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
      capabilities=${props.capabilities}
      onMerge=${props.onMerge}
      onAddComment=${props.onAddComment}
      onRequestReviewers=${props.onRequestReviewers}
      onTriggerReview=${props.onTriggerReview}
    />
  `;
}
