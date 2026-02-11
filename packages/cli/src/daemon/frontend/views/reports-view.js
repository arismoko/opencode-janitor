import { renderReportDetail } from './reports/report-detail.js';
import { renderReportsList } from './reports/reports-list.js';
import { renderReportsMeta } from './reports/reports-meta.js';

export function renderReportsView({
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
        selectedReport,
        detail,
        detailMode,
        setDetailMode,
        deleteReport,
        transcript,
      })}
    </section>
  `;
}
