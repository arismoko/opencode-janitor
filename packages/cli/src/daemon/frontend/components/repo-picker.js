export function renderRepoPicker({
  html,
  selectedRepo,
  repoPickerOpen,
  repoPickerRef,
  toggleRepoPicker,
  repoInputRef,
  repoQuery,
  updateRepoQuery,
  onRepoQueryKeyDown,
  repoOptions,
  repoHighlight,
  setRepoHighlight,
  selectRepo,
}) {
  return html`
    <div class="repo-select" ref=${repoPickerRef}>
      <button
        class="repo-pill"
        aria-label="Select repository"
        aria-expanded=${repoPickerOpen ? 'true' : 'false'}
        onClick=${toggleRepoPicker}
      >
        <span class="repo-pill-text">${selectedRepo?.path || 'Select repository'}</span>
        <span class="repo-chevron">v</span>
      </button>
      ${
        repoPickerOpen &&
        html`
          <div class="repo-dropdown">
            <input
              class="repo-search"
              ref=${repoInputRef}
              value=${repoQuery}
              placeholder="Filter repos by path or branch"
              onInput=${(event) => updateRepoQuery(event.target.value)}
              onKeyDown=${onRepoQueryKeyDown}
            />
            <div class="repo-options">
              ${repoOptions.length === 0 && html`<div class="repo-empty">No repos match.</div>`}
              ${repoOptions.map(
                (repo, index) => html`
                  <button
                    class=${`repo-option ${index === repoHighlight ? 'active' : ''}`}
                    onMouseEnter=${() => setRepoHighlight(index)}
                    onClick=${() => selectRepo(repo.id)}
                  >
                    <span class="path">${repo.path}</span>
                    <span class="meta"
                      >${repo.defaultBranch} · ${repo.runningJobs} running /
                      ${repo.queuedJobs} queued</span
                    >
                  </button>
                `,
              )}
            </div>
          </div>
        `
      }
    </div>
  `;
}
