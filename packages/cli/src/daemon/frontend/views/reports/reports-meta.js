import { fmtAgo } from '../../helpers.js';

function repoStateLabel(repo) {
  if (!repo) return '-';
  if (!repo.enabled) return 'disabled';
  if (repo.paused) return 'paused';
  if (repo.runningJobs > 0) return 'running';
  if (repo.queuedJobs > 0) return 'queued';
  if (repo.idleStreak > 0) return 'idle';
  return 'watching';
}

export function renderReportsMeta({ html, selectedRepo }) {
  return html`
    <section class="reports-meta">
      <div class="meta-grid">
        <div class="meta-item">
          <div class="label">Path</div>
          <div class="value">${selectedRepo?.path || '-'}</div>
        </div>
        <div class="meta-item">
          <div class="label">State</div>
          <div class="value">${repoStateLabel(selectedRepo)}</div>
        </div>
        <div class="meta-item">
          <div class="label">Branch</div>
          <div class="value">${selectedRepo?.defaultBranch || '-'}</div>
        </div>
        <div class="meta-item">
          <div class="label">Jobs</div>
          <div class="value">
            ${
              selectedRepo
                ? `${selectedRepo.runningJobs} running / ${selectedRepo.queuedJobs} queued`
                : '-'
            }
          </div>
        </div>
        <div class="meta-item">
          <div class="label">Next Check</div>
          <div class="value">
            ${
              selectedRepo
                ? `c:${fmtAgo(selectedRepo.nextCommitCheckAt)} | pr:${fmtAgo(selectedRepo.nextPrCheckAt)}`
                : '-'
            }
          </div>
        </div>
      </div>
    </section>
  `;
}
