import htm from 'https://esm.sh/htm@3.1.1';
import { h, render } from 'https://esm.sh/preact@10.26.2';
import { useEffect, useState } from 'https://esm.sh/preact@10.26.2/hooks';
import { api } from './api.js';
import { CapabilityDrivenManualModal } from './components/capability-driven-manual-modal.js';
import { renderDashboardHeader } from './components/dashboard-header.js';
import { renderFlashToast } from './components/flash-toast.js';
import {
  selectFilteredActivity,
  selectJobCounts,
} from './selectors/dashboard-selectors.js';
import { useCapabilities } from './state/use-capabilities.js';
import { useDashboardData } from './state/use-dashboard-data.js';
import { useFlash } from './state/use-flash.js';
import { usePrsData } from './state/use-prs-data.js';
import { useRepoSelection } from './state/use-repo-selection.js';
import { useReportDetail } from './state/use-report-detail.js';
import { useReportSelection } from './state/use-report-selection.js';
import { renderActivityView } from './views/activity-view.js';
import { renderPrsView } from './views/prs-view.js';
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
  const { capabilities } = useCapabilities({
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

  const {
    detail,
    setDetail,
    sessionEvents,
    timelineBlocks,
    transcript,
    sessionHasMore,
    loadMoreSessionEvents,
  } = useReportDetail({
    isReportsView: view === 'reports',
    selectedReport,
    selectedReportId,
    detailMode,
    events,
    onError(error) {
      showFlash(error.message || String(error), 'error');
    },
  });

  const triggerReview = async (repoId, request) => {
    await api('/v1/reviews/enqueue', {
      method: 'POST',
      body: JSON.stringify({ repoOrId: repoId, ...request }),
    });
    showFlash(`Review enqueued (${request.agent})`);
    refreshSnapshot().catch(() => {});
  };

  const deleteReport = async () => {
    if (!selectedReport) return;
    try {
      await api('/v1/dashboard/report', {
        method: 'DELETE',
        body: JSON.stringify({ reviewRunId: selectedReport.id }),
      });
      showFlash('Report deleted');
      setSelectedReportId(null);
      setDetail(null);
      refreshSnapshot().catch(() => {});
    } catch (error) {
      showFlash(error.message || String(error), 'error');
    }
  };

  const stopReview = async (reviewRunId) => {
    try {
      const result = await api('/v1/reviews/stop', {
        method: 'POST',
        body: JSON.stringify({ reviewRunId }),
      });
      if (result.stopped) {
        showFlash('Stop requested');
      } else {
        showFlash('Run is not stoppable in current state', 'error');
      }
      refreshSnapshot().catch(() => {});
    } catch (error) {
      showFlash(error.message || String(error), 'error');
    }
  };

  const resumeReview = async (reviewRunId) => {
    try {
      const result = await api('/v1/reviews/resume', {
        method: 'POST',
        body: JSON.stringify({ reviewRunId }),
      });
      if (result.resumed) {
        showFlash('Run resumed');
      } else {
        showFlash('Run is not resumable in-place', 'error');
      }
      refreshSnapshot().catch(() => {});
    } catch (error) {
      showFlash(error.message || String(error), 'error');
    }
  };

  const clearActivityLog = async () => {
    try {
      const deleted = await clearEvents();
      showFlash(`Cleared ${deleted} events`);
    } catch (error) {
      showFlash(error.message || String(error), 'error');
    }
  };

  const { runningJobs, queuedJobs } = selectJobCounts(repos);
  const filteredActivity = selectFilteredActivity(events, activityFilter);

  const prsData = usePrsData({
    isPrsView: view === 'prs',
    selectedRepo,
    onError(error) {
      showFlash(error.message || String(error), 'error');
    },
  });

  const runPrAction = async (label, action) => {
    try {
      await action();
      showFlash(label);
    } catch (error) {
      showFlash(error.message || String(error), 'error');
    }
  };

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
        <button
          class=${`tab ${view === 'prs' ? 'active' : ''}`}
          onClick=${() => setView('prs')}
        >
          PRs
        </button>
      </nav>

      <main class="content">
        ${
          view === 'reports' &&
          renderReportsView({
            html,
            capabilities,
            selectedRepo,
            filteredReports,
            selectedReport,
            detail,
            detailMode,
            setDetailMode,
            deleteReport,
            stopReview,
            resumeReview,
            setSelectedReportId,
            transcript,
            sessionEvents,
            timelineBlocks,
            sessionHasMore,
            loadMoreSessionEvents,
            showFlash,
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
        ${
          view === 'prs' &&
          renderPrsView({
            html,
            selectedRepo,
            prs: prsData,
            onSelectPr: prsData.setSelectedPrNumber,
            onBucketChange: prsData.setBucket,
            onQueryInput: prsData.setQuery,
            onMerge: (method) =>
              runPrAction('PR merge requested', () => prsData.mergePr(method)),
            onAddComment: (body) =>
              runPrAction('PR comment posted', () => prsData.addComment(body)),
            onRequestReviewers: (reviewers) =>
              runPrAction('Reviewers requested', () =>
                prsData.requestReviewers(reviewers),
              ),
            onReply: (commentId, body) =>
              runPrAction('Reply posted', () =>
                prsData.replyToComment(commentId, body),
              ),
          })
        }
      </main>

      ${renderFlashToast({ html, flash })}

      <${CapabilityDrivenManualModal}
        html=${html}
        pickerRepoId=${pickerRepoId}
        setPickerRepoId=${setPickerRepoId}
        capabilities=${capabilities}
        triggerReview=${triggerReview}
      />
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
