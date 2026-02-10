import { Box, Text } from 'ink';
import { Pane } from '../components/pane';
import { ReportDetailPane } from '../components/report-detail-pane';
import { ScrollableList } from '../components/scrollable-list';
import {
  relativeTime,
  severityBar,
  shortRepoName,
  statusIcon,
  truncate,
} from '../helpers';
import type {
  CachedReportDetail,
  DashboardReportSummary,
  DetailMode,
  EventJournalEntry,
  FocusPane,
} from '../types';

export interface ReportsViewProps {
  reports: DashboardReportSummary[];
  reportIndex: number;
  focusPane: FocusPane;
  isNarrow: boolean;
  listPaneWidth: number;
  detailPaneWidth: number;
  visibleListRows: number;
  reportWindowStart: number;
  nowTs: number;
  /** Detail pane state */
  currentDetail: CachedReportDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  detailOffset: number;
  detailVisibleRows: number;
  /** Live session events for the selected report. */
  sessionEvents: EventJournalEntry[];
  /** Controls what the detail pane displays. */
  detailMode: DetailMode;
  /** Historical session events for completed reports (from API fetch). */
  historicalSessionEvents: EventJournalEntry[];
}

function renderReportItem(
  rpt: DashboardReportSummary,
  absIdx: number,
  selected: boolean,
  nowTs: number,
  innerWidth: number,
) {
  const si = statusIcon(rpt.status);
  const marker = selected ? '>' : ' ';
  const timeStr = rpt.finishedAt
    ? relativeTime(rpt.finishedAt, nowTs)
    : rpt.startedAt
      ? 'running'
      : '';
  const sevBar = severityBar(rpt);

  // Fixed-width column layout constrained to innerWidth.
  // Shape: marker(1) ·icon(1) ·agent(W) ·repo(W) ·severity(W) ·time(W)
  // Total = 7 + agentW + repoW + sevW + timeW  (7 = marker + icon + 5 separating spaces)
  const agentW = 7;
  const timeW = 7;
  const flexBudget = innerWidth - 7 - agentW - timeW;
  const sevW = Math.max(1, Math.min(12, Math.ceil(flexBudget * 0.4)));
  const repoW = Math.max(4, flexBudget - sevW);

  return (
    <>
      <Text color={selected ? 'cyan' : 'gray'}>{marker}</Text>
      <Text color={si.color}> {si.icon}</Text>
      <Text color={selected ? 'white' : 'gray'}>
        {' '}
        {truncate(rpt.agent, agentW).padEnd(agentW)}
      </Text>
      <Text color="gray">
        {' '}
        {truncate(shortRepoName(rpt.repoPath), repoW).padEnd(repoW)}
      </Text>
      <Text color="gray" dimColor>
        {' '}
        {truncate(sevBar, sevW).padEnd(sevW)}
      </Text>
      <Text color="gray" dimColor>
        {' '}
        {truncate(timeStr, timeW)}
      </Text>
    </>
  );
}

export function ReportsView(props: ReportsViewProps) {
  const {
    reports,
    reportIndex,
    focusPane,
    isNarrow,
    listPaneWidth,
    detailPaneWidth,
    visibleListRows,
    reportWindowStart,
    nowTs,
    currentDetail,
    detailLoading,
    detailError,
    detailOffset,
    detailVisibleRows,
    sessionEvents,
    detailMode,
    historicalSessionEvents,
  } = props;

  // Pane border (2) + paddingX (2) = 4 chars of horizontal overhead
  const listInnerWidth = listPaneWidth - 4;
  const detailExpanded = focusPane === 'detail';

  return (
    <Box flexDirection={isNarrow ? 'column' : 'row'} flexGrow={1}>
      {!detailExpanded && (
        <Pane
          title={`Reports (${reports.length})`}
          focused={focusPane === 'list'}
          width={isNarrow ? undefined : listPaneWidth}
        >
          <ScrollableList
            items={reports}
            selectedIndex={reportIndex}
            windowStart={reportWindowStart}
            visibleRows={visibleListRows}
            keyExtractor={(r) => r.id}
            emptyMessage="No reports yet."
            renderItem={(rpt, absIdx, selected) =>
              renderReportItem(rpt, absIdx, selected, nowTs, listInnerWidth)
            }
          />
        </Pane>
      )}

      <Pane
        title={detailExpanded ? 'Detail (h/esc to go back)' : 'Detail'}
        focused={detailExpanded}
        marginLeft={detailExpanded || isNarrow ? 0 : 1}
        marginTop={isNarrow && !detailExpanded ? 1 : 0}
      >
        <ReportDetailPane
          detail={currentDetail}
          loading={detailLoading}
          error={detailError}
          detailOffset={detailOffset}
          detailVisibleRows={detailVisibleRows}
          termWidth={detailPaneWidth}
          nowTs={nowTs}
          sessionEvents={sessionEvents}
          detailMode={detailMode}
          historicalSessionEvents={historicalSessionEvents}
        />
      </Pane>
    </Box>
  );
}
