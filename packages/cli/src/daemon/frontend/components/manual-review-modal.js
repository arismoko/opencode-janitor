export function renderManualReviewModal({
  html,
  pickerRepoId,
  setPickerRepoId,
  agents,
  triggerReview,
}) {
  if (!pickerRepoId) return null;

  return html`
    <div class="overlay" onClick=${() => setPickerRepoId(null)}>
      <div class="modal" onClick=${(event) => event.stopPropagation()}>
        <div style="padding:12px 12px 8px;">
          <strong>Trigger Manual Review</strong>
          <div class="muted" style="font-size:12px; margin-top:4px;">Choose an agent</div>
        </div>
        ${agents.map(
          (agent) => html`
            <button
              onClick=${() => {
                triggerReview(pickerRepoId, agent.key);
                setPickerRepoId(null);
              }}
            >
              ${agent.label}
            </button>
          `,
        )}
      </div>
    </div>
  `;
}
