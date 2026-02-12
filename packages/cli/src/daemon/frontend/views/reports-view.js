import { renderReportDetail } from './reports/report-detail.js';
import { renderReportsList } from './reports/reports-list.js';
import { renderReportsMeta } from './reports/reports-meta.js';

export function renderReportsView({
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
}) {
  return html`
    ${renderReportsMeta({ html, selectedRepo })}
    <section class="reports-layout">
      ${renderReportsList({
        html,
        filteredReports,
        selectedReport,
        setSelectedReportId,
      })}
      ${renderReportDetail({
        html,
        capabilities,
        selectedReport,
        detail,
        detailMode,
        setDetailMode,
        deleteReport,
        stopReview,
        resumeReview,
        transcript,
        sessionEvents,
        timelineBlocks,
        sessionHasMore,
        loadMoreSessionEvents,
        showFlash,
      })}
    </section>
  `;
}
