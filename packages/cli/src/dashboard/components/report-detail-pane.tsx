import { Box, Text } from 'ink';
import {
  buildTranscript,
  clamp,
  relativeTime,
  shortRepoName,
  statusIcon,
  wrapLines,
} from '../helpers';
import type {
  CachedReportDetail,
  DetailMode,
  EventJournalEntry,
} from '../types';
import { FindingRow } from './finding-row';

export interface ReportDetailPaneProps {
  detail: CachedReportDetail | null;
  loading: boolean;
  error: string | null;
  detailOffset: number;
  detailVisibleRows: number;
  termWidth: number;
  nowTs: number;
  /** Controls what the detail pane displays. */
  detailMode: DetailMode;
  /** Live session events for running reports (from SSE stream). */
  sessionEvents?: EventJournalEntry[];
  /** Historical session events for completed reports (from API fetch). */
  historicalSessionEvents?: EventJournalEntry[];
}

// ---------------------------------------------------------------------------
// Session transcript sub-section
// ---------------------------------------------------------------------------

function SessionSection({
  events,
  isLive,
  contentWidth,
  visibleLines,
  scrollOffset,
  modeHint,
}: {
  events: EventJournalEntry[];
  isLive: boolean;
  contentWidth: number;
  visibleLines: number;
  scrollOffset: number;
  modeHint?: string;
}) {
  const transcript = buildTranscript(events);
  const lines = wrapLines(transcript, contentWidth - 2);

  const totalLines = lines.length;
  let startLine: number;
  if (isLive) {
    // Auto-scroll to bottom for live sessions
    startLine = Math.max(0, totalLines - visibleLines);
  } else {
    startLine = clamp(scrollOffset, 0, Math.max(0, totalLines - visibleLines));
  }
  const endLine = Math.min(totalLines, startLine + visibleLines);
  const visibleSlice = lines.slice(startLine, endLine);

  const headerRight = isLive ? '● live' : (modeHint ?? '');
  const headerLabel = isLive ? 'Session' : 'Session History';
  const pad = Math.max(
    0,
    contentWidth - 6 - headerLabel.length - headerRight.length,
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray" dimColor>
        ── {headerLabel} ──{'─'.repeat(pad)} {headerRight} ──
      </Text>
      {visibleSlice.length === 0 ? (
        <Text color="gray">No session events.</Text>
      ) : (
        visibleSlice.map((line, i) => (
          <Text key={startLine + i} wrap="truncate-end">
            {isLive && i === visibleSlice.length - 1 ? `${line}▌` : line}
          </Text>
        ))
      )}
      {!isLive && endLine < totalLines && (
        <Text color="gray" dimColor>
          ↕ j/k to scroll ({totalLines - endLine} more)
        </Text>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Findings sub-section (extracted from previous inline rendering)
// ---------------------------------------------------------------------------

function FindingsSection({
  findings,
  rawOutput,
  contentWidth,
  detailOffset,
  detailVisibleRows,
  modeHint,
}: {
  findings: CachedReportDetail['data']['findings'];
  rawOutput: string | null;
  contentWidth: number;
  detailOffset: number;
  detailVisibleRows: number;
  modeHint: string;
}) {
  if (findings.length > 0) {
    const endIdx = Math.min(detailOffset + detailVisibleRows, findings.length);
    const pad = Math.max(0, contentWidth - 30 - modeHint.length);
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="gray" dimColor>
          ── Findings {detailOffset + 1}-{endIdx} of {findings.length} ──
          {'─'.repeat(pad)} {modeHint} ──
        </Text>
        {findings
          .slice(detailOffset, detailOffset + detailVisibleRows)
          .map((f) => (
            <FindingRow key={f.id} finding={f} width={contentWidth} />
          ))}
        {detailOffset + detailVisibleRows < findings.length && (
          <Text color="gray" dimColor>
            ↓ {findings.length - detailOffset - detailVisibleRows} more (j/k to
            scroll)
          </Text>
        )}
      </Box>
    );
  }

  if (rawOutput) {
    return (
      <Box flexDirection="column" marginTop={1} width={contentWidth}>
        <Text color="gray" dimColor>
          Raw output (no structured findings):
        </Text>
        <Text wrap="wrap">{rawOutput}</Text>
      </Box>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReportDetailPane(props: ReportDetailPaneProps) {
  const {
    detail,
    loading,
    error,
    detailOffset,
    detailVisibleRows,
    termWidth,
    nowTs,
    detailMode,
    sessionEvents = [],
    historicalSessionEvents = [],
  } = props;

  if (loading) {
    return (
      <Box flexDirection="column">
        <Text color="cyan">Loading report detail...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
        <Text color="gray" dimColor>
          Move cursor to another report and back, or press r to refresh.
        </Text>
      </Box>
    );
  }

  if (!detail) {
    return (
      <Box flexDirection="column">
        <Text color="gray">Select a report to view details.</Text>
      </Box>
    );
  }

  const { report, findings, rawOutput } = detail.data;
  const si = statusIcon(report.status);
  const contentWidth = Math.max(20, termWidth - 4);
  const isRunning = report.status === 'running' || report.status === 'queued';
  const showSession = detailMode === 'session';
  const modeHint = showSession ? '(t for findings)' : '(t for session)';

  return (
    <Box flexDirection="column">
      {/* Compact metadata header */}
      <Box>
        <Text color={si.color} bold>
          {si.icon} {report.agent}
        </Text>
        <Text color="gray">
          {' '}
          {report.status}
          {report.outcome ? ` / ${report.outcome}` : ''}
        </Text>
        <Text color="gray">
          {' -- '}
          {shortRepoName(report.repoPath)}
          {report.subjectKey ? ` / ${report.subjectKey}` : ''}
        </Text>
      </Box>

      <Box>
        <Text color="gray" dimColor>
          started{' '}
          {report.startedAt ? relativeTime(report.startedAt, nowTs) : '-'}
          {'  ·  '}
          finished{' '}
          {report.finishedAt ? relativeTime(report.finishedAt, nowTs) : '-'}
        </Text>
      </Box>

      {report.errorMessage && (
        <Text color="red" wrap="wrap">
          error: {report.errorMessage}
        </Text>
      )}

      {/* Severity summary */}
      <Box marginTop={1}>
        {report.p0Count > 0 && (
          <Text color="red" bold>
            P0:{report.p0Count}{' '}
          </Text>
        )}
        {report.p1Count > 0 && (
          <Text color="yellow" bold>
            P1:{report.p1Count}{' '}
          </Text>
        )}
        {report.p2Count > 0 && <Text color="blue">P2:{report.p2Count} </Text>}
        {report.p3Count > 0 && <Text color="gray">P3:{report.p3Count} </Text>}
        {report.findingsCount === 0 && <Text color="gray">No findings</Text>}
      </Box>

      {/* ---- MUTUALLY EXCLUSIVE SECTION ---- */}

      {showSession ? (
        <SessionSection
          events={isRunning ? sessionEvents : historicalSessionEvents}
          isLive={isRunning}
          contentWidth={contentWidth}
          visibleLines={Math.max(6, detailVisibleRows * 5)}
          scrollOffset={detailOffset}
          modeHint={isRunning ? undefined : modeHint}
        />
      ) : (
        <FindingsSection
          findings={findings}
          rawOutput={rawOutput}
          contentWidth={contentWidth}
          detailOffset={detailOffset}
          detailVisibleRows={detailVisibleRows}
          modeHint={modeHint}
        />
      )}
    </Box>
  );
}
