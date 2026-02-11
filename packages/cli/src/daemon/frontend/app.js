import htm from 'https://esm.sh/htm@3.1.1';
import { h, render } from 'https://esm.sh/preact@10.26.2';
import { useEffect, useState } from 'https://esm.sh/preact@10.26.2/hooks';
import { api } from './api.js';
import { renderDashboardHeader } from './components/dashboard-header.js';
import { renderFlashToast } from './components/flash-toast.js';
import { renderManualReviewModal } from './components/manual-review-modal.js';
import { AGENTS } from './constants.js';
import {
  selectFilteredActivity,
  selectJobCounts,
} from './selectors/dashboard-selectors.js';
import { useDashboardData } from './state/use-dashboard-data.js';
import { useFlash } from './state/use-flash.js';
import { useRepoSelection } from './state/use-repo-selection.js';
import { useReportDetail } from './state/use-report-detail.js';
import { useReportSelection } from './state/use-report-selection.js';
import { renderActivityView } from './views/activity-view.js';
import { renderReportsView } from './views/reports-view.js';

const html = htm.bind(h);

function App() {
  const [view, setView] = useState('reports');
  const [detailMode, setDetailMode] = useState('findings');
  const [activityFilter, setActivityFilter] = useState('info+');
  const [pickerRepoId, setPickerRepoId] = useState(null);
  const [, setNow] = useState(Date.now());
  const { flash, showFlash } = useFlash();

  const { snapshot, events, streamState, refreshSnapshot, clearEvents } =
    useDashboardData({
      onError(error) {
        showFlash(error.message || String(error), 'error');
      },
    });

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearInterval(tick);
    };
  }, []);

  const reports = snapshot?.reports ?? [];
  const repos = snapshot?.repos ?? [];
  const daemon = snapshot?.daemon;

  const {
    selectedRepoId,
    selectedRepo,
    repoOptions,
    repoPickerOpen,
    repoQuery,
    repoHighlight,
    repoPickerRef,
    repoInputRef,
    setRepoHighlight,
    toggleRepoPicker,
    updateRepoQuery,
    selectRepo,
    onRepoQueryKeyDown,
  } = useRepoSelection(repos);

  const {
    selectedReportId,
    setSelectedReportId,
    filteredReports,
    selectedReport,
  } = useReportSelection({
    reports,
    selectedRepoId,
  });

  const { detail, setDetail, transcript } = useReportDetail({
    selectedReport,
    selectedReportId,
    reportsLength: reports.length,
    detailMode,
    events,
    onError(error) {
      showFlash(error.message || String(error), 'error');
    },
  });

  const triggerReview = async (repoId, agent) => {
    try {
      await api('/v1/reviews/enqueue', {
        method: 'POST',
        body: JSON.stringify({ repoOrId: repoId, agent }),
      });
      showFlash(`Review enqueued (${agent})`);
      refreshSnapshot().catch(() => {});
    } catch (error) {
      showFlash(error.message || String(error), 'error');
    }
  };

  const deleteReport = async () => {
    if (!selectedReport) return;
    try {
      await api('/v1/dashboard/report', {
        method: 'DELETE',
        body: JSON.stringify({ agentRunId: selectedReport.id }),
      });
      showFlash('Report deleted');
      setSelectedReportId(null);
      setDetail(null);
      refreshSnapshot().catch(() => {});
    } catch (error) {
      showFlash(error.message || String(error), 'error');
    }
  };

  const clearActivityLog = () => {
    clearEvents();
    showFlash('Activity log cleared');
  };

  const { runningJobs, queuedJobs } = selectJobCounts(repos);
  const filteredActivity = selectFilteredActivity(events, activityFilter);

  return html`
    <div id="root">
      ${renderDashboardHeader({
        html,
        selectedRepo,
        onRunReview: () => setPickerRepoId(selectedRepo?.id || null),
        daemon,
        reposCount: repos.length,
        runningJobs,
        queuedJobs,
        streamState,
        repoPicker: {
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
        },
      })}

      <nav class="tabs">
        <button
          class=${`tab ${view === 'reports' ? 'active' : ''}`}
          onClick=${() => setView('reports')}
        >
          Reports
        </button>
        <button
          class=${`tab ${view === 'activity' ? 'active' : ''}`}
          onClick=${() => setView('activity')}
        >
          Activity
        </button>
      </nav>

      <main class="content">
        ${
          view === 'reports' &&
          renderReportsView({
            html,
            selectedRepo,
            filteredReports,
            selectedReport,
            detail,
            detailMode,
            setDetailMode,
            deleteReport,
            setSelectedReportId,
            transcript,
          })
        }
        ${
          view === 'activity' &&
          renderActivityView({
            html,
            filteredActivity,
            clearActivityLog,
            setActivityFilter,
          })
        }
      </main>

      ${renderFlashToast({ html, flash })}

      ${renderManualReviewModal({
        html,
        pickerRepoId,
        setPickerRepoId,
        agents: AGENTS,
        triggerReview,
      })}
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
