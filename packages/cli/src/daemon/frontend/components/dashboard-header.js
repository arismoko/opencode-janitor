import { renderRepoPicker } from './repo-picker.js';

export function renderDashboardHeader({
  html,
  selectedRepo,
  onRunReview,
  daemon,
  reposCount,
  runningJobs,
  queuedJobs,
  streamState,
  repoPicker,
}) {
  return html`
    <header class="header">
      <div class="header-left">
        <div class="brand"><span class="brand-dot"></span>opencode-janitor</div>
        ${renderRepoPicker({ html, selectedRepo, ...repoPicker })}
        <button class="btn" onClick=${onRunReview} ?disabled=${!selectedRepo}>
          Run Review
        </button>
      </div>
      <div class="stats">
        <span
          >uptime
          <span class="stat-value"
            >${daemon ? `${Math.floor(daemon.uptimeMs / 60000)}m` : '-'}</span
          ></span
        >
        <span>repos <span class="stat-value">${reposCount}</span></span>
        <span>running <span class="stat-value">${runningJobs}</span></span>
        <span>queued <span class="stat-value">${queuedJobs}</span></span>
      </div>
      <div class=${`stream stream-${streamState}`}>
        <span class="stream-dot"></span>
        <span>${streamState.toUpperCase()}</span>
      </div>
    </header>
  `;
}
