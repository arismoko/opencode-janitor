import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copyToClipboard, serializeReportForClipboard } from './clipboard';
import { Header } from './components/header';
import { KeybindingsFooter } from './components/keybindings-footer';
import { StatusBar } from './components/status-bar';
import {
  buildTranscript,
  clamp,
  eventLevelRank,
  mergeEvents,
  shortRepoName,
  sleep,
  toErrorMessage,
  wrapLines,
} from './helpers';
import { DETAIL_KEYMAP, GLOBAL_KEYMAP, LIST_KEYMAP } from './keymap/keymap';
import { useScopedKeymap } from './keymap/use-scoped-keymap';
import {
  deleteReport,
  enqueueReview,
  fetchReportDetail,
  fetchSessionEvents,
  fetchSnapshot,
} from './transport/daemon-client';
import { openEventStream } from './transport/event-stream';
import type {
  CachedReportDetail,
  DashboardReportSummary,
  DashboardRepoState,
  DashboardSnapshotResponse,
  DetailMode,
  ErrorResponse,
  EventJournalEntry,
  EventsResponse,
  FocusPane,
  StreamScope,
  StreamState,
  ViewMode,
} from './types';
import { ActivityView } from './views/activity-view';
import { ReportsView } from './views/reports-view';
import { ReposView } from './views/repos-view';

const MAX_EVENTS_BUFFER = 600;

const AGENT_PICKER_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'janitor', label: 'Janitor' },
  { key: 'hunter', label: 'Hunter' },
  { key: 'inspector', label: 'Inspector' },
  { key: 'scribe', label: 'Scribe' },
];

export interface DashboardAppProps {
  socketPath: string;
  eventsLimit: number;
  reportsLimit: number;
  findingsLimit: number;
  pollMs: number;
  refreshMs: number;
  initial: DashboardSnapshotResponse;
}

export function DashboardApp(props: DashboardAppProps) {
  const {
    socketPath,
    eventsLimit,
    reportsLimit,
    findingsLimit,
    pollMs,
    refreshMs,
    initial,
  } = props;

  const { exit } = useApp();
  const { stdout } = useStdout();
  const termCols = stdout?.columns ?? 120;
  const termRows = stdout?.rows ?? 36;

  const [viewMode, setViewMode] = useState<ViewMode>('reports');
  const [focusPane, setFocusPane] = useState<FocusPane>('list');
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const [paused, setPaused] = useState(false);

  const [daemon, setDaemon] = useState(initial.daemon);
  const [repos, setRepos] = useState<DashboardRepoState[]>(initial.repos);
  const [reports, setReports] = useState<DashboardReportSummary[]>(
    initial.reports,
  );
  const [events, setEvents] = useState<EventJournalEntry[]>(initial.events);
  const [nowTs, setNowTs] = useState(Date.now());
  const [lastRefreshTs, setLastRefreshTs] = useState(initial.generatedAt);

  const [reportIndex, setReportIndex] = useState(0);
  const [repoIndex, setRepoIndex] = useState(0);
  const [eventOffset, setEventOffset] = useState(0);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailOffset, setDetailOffset] = useState(0);
  const [currentDetail, setCurrentDetail] = useState<CachedReportDetail | null>(
    null,
  );

  const [streamError, setStreamError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [bufferedWhilePaused, setBufferedWhilePaused] = useState(0);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [flashTone, setFlashTone] = useState<
    'green' | 'yellow' | 'red' | 'cyan'
  >('green');
  const [activityLevelFilter, setActivityLevelFilter] = useState<
    'all' | 'info+' | 'warn+' | 'error'
  >('info+');
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [agentPickerIndex, setAgentPickerIndex] = useState(0);
  const [pendingReviewRepoId, setPendingReviewRepoId] = useState<string | null>(
    null,
  );

  const latestSeqRef = useRef<number>(initial.latestSeq);
  const latestSignalTsRef = useRef<number>(Date.now());
  const pausedRef = useRef<boolean>(paused);
  const detailCacheRef = useRef<Map<string, CachedReportDetail>>(new Map());
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const showFlash = useCallback(
    (message: string, tone: 'green' | 'yellow' | 'red' | 'cyan' = 'green') => {
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
      setFlashMessage(message);
      setFlashTone(tone);
      flashTimeoutRef.current = setTimeout(() => {
        setFlashMessage(null);
      }, 2200);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  const selectedReport = reports[reportIndex] ?? null;
  const selectedRepo = repos[repoIndex] ?? null;

  // Auto-scope the stream based on current view context.
  // Only scope to 'report' when detail pane is focused (avoids SSE thrashing
  // while browsing the list with j/k).
  const streamScope = useMemo<StreamScope>(() => {
    if (viewMode === 'reports' && focusPane === 'detail' && selectedReport)
      return 'report';
    if (viewMode === 'repos' && selectedRepo) return 'repo';
    return 'all';
  }, [viewMode, focusPane, selectedReport, selectedRepo]);

  const [detailMode, setDetailMode] = useState<DetailMode>('findings');
  const [historicalSessionEvents, setHistoricalSessionEvents] = useState<
    EventJournalEntry[]
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Auto-set detailMode based on report status
  const selectedReportId = selectedReport?.id ?? null;
  const selectedReportStatus = selectedReport?.status ?? null;

  useEffect(() => {
    if (!selectedReportId) {
      setDetailMode('findings');
      setHistoricalSessionEvents([]);
      return;
    }
    const isRunning =
      selectedReportStatus === 'running' || selectedReportStatus === 'queued';
    setDetailMode(isRunning ? 'session' : 'findings');
    setHistoricalSessionEvents([]);
  }, [selectedReportId, selectedReportStatus]);

  // Fetch historical session events for completed reports on demand
  useEffect(() => {
    if (detailMode !== 'session' || !selectedReport) return;
    const isRunning =
      selectedReport.status === 'running' || selectedReport.status === 'queued';
    if (isRunning) return; // live session uses SSE events, not API fetch

    let cancelled = false;
    setHistoryLoading(true);

    void fetchSessionEvents(
      { socketPath, timeoutMs: 5000 },
      selectedReport.id,
      { limit: 500 },
    )
      .then((response) => {
        if (cancelled) return;
        if (response.status === 200) {
          const data = response.data as EventsResponse;
          setHistoricalSessionEvents(data.events);
        }
      })
      .catch(() => {
        /* silently fail, user sees empty session */
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailMode, selectedReport, socketPath]);

  /** Compute the stream filter params from current auto-derived scope. */
  const scopeFilterParams = useMemo(() => {
    if (streamScope === 'repo') {
      const repo = selectedRepo;
      if (repo) return { repoId: repo.id } as Record<string, string>;
      return {} as Record<string, string>;
    }
    if (streamScope === 'report') {
      const report = selectedReport;
      if (report) return { agentRunId: report.id } as Record<string, string>;
      return {} as Record<string, string>;
    }
    return {} as Record<string, string>;
  }, [streamScope, selectedReport, selectedRepo]);

  const refreshSnapshot = useCallback(async () => {
    const response = await fetchSnapshot(
      { socketPath, timeoutMs: 3000 },
      { eventsLimit, reportsLimit },
    );

    if (response.status !== 200) {
      const err = response.data as ErrorResponse;
      throw new Error(
        err.error?.message ?? 'Failed to refresh dashboard snapshot',
      );
    }

    const next = response.data as DashboardSnapshotResponse;
    latestSeqRef.current = next.latestSeq;
    latestSignalTsRef.current = Date.now();
    setDaemon(next.daemon);
    setRepos(next.repos);
    setReports(next.reports);
    setEvents((prev) => mergeEvents(prev, next.events, MAX_EVENTS_BUFFER));
    setLastRefreshTs(next.generatedAt);
    setRefreshError(null);
    setStreamState('live');
  }, [socketPath, eventsLimit, reportsLimit]);

  const submitReview = useCallback(
    (repoId: string, agent: string) => {
      void enqueueReview({ socketPath, timeoutMs: 3000 }, repoId, agent)
        .then((response) => {
          if (response.status !== 200) {
            const err = response.data as ErrorResponse;
            throw new Error(err.error?.message ?? 'Failed to enqueue review');
          }
          const payload = response.data as { repoPath: string };
          const repoName = shortRepoName(payload.repoPath);
          const withAgent = agent ? ` (${agent})` : '';
          showFlash(`Review enqueued for ${repoName}${withAgent}`, 'green');
          void refreshSnapshot().catch(() => {});
        })
        .catch((error: unknown) => {
          const message = toErrorMessage(error);
          showFlash(`Enqueue failed: ${message}`, 'red');
        });
    },
    [refreshSnapshot, showFlash, socketPath],
  );

  useInput(
    (input, key) => {
      if (!agentPickerOpen) {
        return;
      }

      if (key.escape) {
        setAgentPickerOpen(false);
        setPendingReviewRepoId(null);
        showFlash('Agent picker cancelled', 'yellow');
        return;
      }

      if (key.upArrow || input === 'k') {
        setAgentPickerIndex((index) =>
          Math.max(0, Math.min(AGENT_PICKER_OPTIONS.length - 1, index - 1)),
        );
        return;
      }

      if (key.downArrow || input === 'j') {
        setAgentPickerIndex((index) =>
          Math.max(0, Math.min(AGENT_PICKER_OPTIONS.length - 1, index + 1)),
        );
        return;
      }

      if (key.return) {
        if (!pendingReviewRepoId) {
          setAgentPickerOpen(false);
          return;
        }
        const selected =
          AGENT_PICKER_OPTIONS[agentPickerIndex] ?? AGENT_PICKER_OPTIONS[0];
        setAgentPickerOpen(false);
        setPendingReviewRepoId(null);
        submitReview(pendingReviewRepoId, selected.key);
      }
    },
    { isActive: agentPickerOpen },
  );

  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const staleMs = Date.now() - latestSignalTsRef.current;
      if (streamState === 'live' && staleMs > 10_000) {
        setStreamState('stale');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [streamState]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshSnapshot().catch((error: unknown) => {
        const message = toErrorMessage(error);
        setRefreshError(message);
      });
    }, refreshMs);

    return () => clearInterval(timer);
  }, [refreshMs, refreshSnapshot]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      let backoffMs = 500;

      while (!cancelled) {
        try {
          setStreamState('connecting');
          setStreamError(null);

          await openEventStream(
            {
              socketPath,
              afterSeq: latestSeqRef.current,
              pollMs,
              signal: controller.signal,
              ...scopeFilterParams,
            },
            {
              onReady: (afterSeq) => {
                latestSeqRef.current = Math.max(latestSeqRef.current, afterSeq);
                latestSignalTsRef.current = Date.now();
                setStreamState('live');
              },
              onHeartbeat: (afterSeq) => {
                latestSeqRef.current = Math.max(latestSeqRef.current, afterSeq);
                latestSignalTsRef.current = Date.now();
                setStreamState('live');
              },
              onEvent: (entry) => {
                latestSeqRef.current = Math.max(
                  latestSeqRef.current,
                  entry.eventId,
                );
                latestSignalTsRef.current = Date.now();
                if (pausedRef.current) {
                  setBufferedWhilePaused((count) => count + 1);
                  return;
                }
                setEvents((prev) =>
                  mergeEvents(prev, [entry], MAX_EVENTS_BUFFER),
                );
                setStreamState('live');
              },
              onError: (message) => {
                setStreamError(message);
              },
            },
          );

          if (!cancelled) {
            setStreamState('stale');
            await sleep(backoffMs);
            backoffMs = Math.min(5000, backoffMs * 2);
          }
        } catch (error) {
          if (cancelled) return;
          const message = toErrorMessage(error);
          setStreamError(message);
          setStreamState('error');
          await sleep(backoffMs);
          backoffMs = Math.min(5000, backoffMs * 2);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // streamGeneration triggers reconnect when scope changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketPath, pollMs, scopeFilterParams]);

  useEffect(() => {
    if (!selectedReport) {
      setCurrentDetail(null);
      return;
    }

    const cache = detailCacheRef.current.get(selectedReport.id);
    if (cache) {
      setCurrentDetail(cache);
      setDetailError(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    void fetchReportDetail({ socketPath, timeoutMs: 5000 }, selectedReport.id, {
      findingsLimit,
    })
      .then((response) => {
        if (cancelled) return;
        if (response.status !== 200) {
          const err = response.data as ErrorResponse;
          throw new Error(
            err.error?.message ?? 'Failed to fetch report detail',
          );
        }
        const detail = {
          data: response.data,
          fetchedAt: Date.now(),
        } as CachedReportDetail;
        detailCacheRef.current.set(selectedReport.id, detail);
        setCurrentDetail(detail);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = toErrorMessage(error);
        setDetailError(message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedReport, socketPath, findingsLimit]);

  const activeKeyScopes = useMemo(() => {
    const scopes = [GLOBAL_KEYMAP, LIST_KEYMAP];
    if (viewMode === 'reports' && focusPane === 'detail') {
      scopes.unshift(DETAIL_KEYMAP);
    }
    return scopes;
  }, [viewMode, focusPane]);

  const minLevel = useMemo(() => {
    switch (activityLevelFilter) {
      case 'all':
        return 0;
      case 'info+':
        return 1;
      case 'warn+':
        return 2;
      case 'error':
        return 3;
    }
  }, [activityLevelFilter]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => eventLevelRank(event.level) >= minLevel);
  }, [events, minLevel]);

  /** Session events for the selected report (filtered from in-memory events). */
  const sessionEvents = useMemo(() => {
    if (!selectedReport) return [];
    const sessionId = selectedReport.sessionId;
    const agentRunId = selectedReport.id;
    return events.filter((ev) => {
      // Match session topics associated with this report.
      if (
        !ev.topic.startsWith('session.') ||
        (ev.agentRunId !== agentRunId &&
          (!sessionId || ev.sessionId !== sessionId))
      ) {
        return false;
      }
      return true;
    });
  }, [events, selectedReport]);

  const isNarrow = termCols < 108 || termRows < 24;
  const listPaneWidth = isNarrow ? termCols : 46;
  const detailPaneWidth =
    focusPane === 'detail' || isNarrow
      ? termCols
      : termCols - listPaneWidth - 3;
  const visibleListRows = Math.max(6, termRows - 14);
  const visibleEventRows = Math.max(6, termRows - 14);
  const detailVisibleFindings = Math.max(2, Math.floor((termRows - 13) / 5));
  const detailVisibleSessionLines = Math.max(6, detailVisibleFindings * 5);

  const detailSessionEvents = useMemo(
    () =>
      historicalSessionEvents.length > 0
        ? historicalSessionEvents
        : sessionEvents,
    [historicalSessionEvents, sessionEvents],
  );

  const detailSessionLineCount = useMemo(() => {
    const transcript = buildTranscript(detailSessionEvents);
    const contentWidth = Math.max(20, detailPaneWidth - 4);
    return wrapLines(transcript, contentWidth - 2).length;
  }, [detailPaneWidth, detailSessionEvents]);

  const handleAction = useCallback(
    (action: string) => {
      switch (action) {
        case 'app:quit': {
          exit();
          return;
        }
        case 'app:refresh': {
          void refreshSnapshot()
            .then(() => {
              showFlash('Snapshot refreshed', 'cyan');
            })
            .catch((error: unknown) => {
              const message = toErrorMessage(error);
              setRefreshError(message);
              showFlash(`Refresh failed: ${message}`, 'red');
            });
          return;
        }
        case 'view:reports': {
          setViewMode('reports');
          return;
        }
        case 'view:repos': {
          setViewMode('repos');
          return;
        }
        case 'view:activity': {
          setViewMode('activity');
          return;
        }
        case 'stream:pause': {
          setPaused((value) => {
            const next = !value;
            if (value && !next) {
              setBufferedWhilePaused(0);
              void refreshSnapshot().catch((error: unknown) => {
                const message = toErrorMessage(error);
                setRefreshError(message);
              });
            }
            showFlash(next ? 'Stream paused' : 'Stream resumed', 'yellow');
            return next;
          });
          return;
        }
        case 'report:copy': {
          if (viewMode !== 'reports') {
            return;
          }
          if (
            !selectedReport ||
            !currentDetail ||
            currentDetail.data.report.id !== selectedReport.id
          ) {
            showFlash('Select a report with loaded details first', 'yellow');
            return;
          }
          try {
            const text = serializeReportForClipboard(currentDetail);
            copyToClipboard(text);
            showFlash(
              `Copied report for ${shortRepoName(selectedReport.repoPath)}`,
              'green',
            );
          } catch (error) {
            const message = toErrorMessage(error);
            showFlash(`Copy failed: ${message}`, 'red');
          }
          return;
        }
        case 'review:trigger': {
          if (viewMode !== 'reports' && viewMode !== 'repos') {
            return;
          }
          const repoId =
            viewMode === 'repos'
              ? (repos[repoIndex]?.id ?? null)
              : (selectedReport?.repoId ?? null);

          if (!repoId) {
            showFlash('No repo selected to enqueue', 'yellow');
            return;
          }

          setPendingReviewRepoId(repoId);
          setAgentPickerIndex(0);
          setAgentPickerOpen(true);
          showFlash('Select an agent, then press Enter', 'cyan');
          return;
        }
        case 'report:delete': {
          if (viewMode !== 'reports') {
            return;
          }
          if (!selectedReport) {
            showFlash('No report selected', 'yellow');
            return;
          }

          void deleteReport({ socketPath, timeoutMs: 3000 }, selectedReport.id)
            .then((response) => {
              if (response.status !== 200) {
                const err = response.data as ErrorResponse;
                throw new Error(
                  err.error?.message ?? 'Failed to delete report',
                );
              }
              const payload = response.data as { deleted: boolean };
              if (!payload.deleted) {
                showFlash('Report not found or not deletable yet', 'yellow');
                void refreshSnapshot().catch(() => {});
                return;
              }
              detailCacheRef.current.delete(selectedReport.id);
              setCurrentDetail(null);
              setDetailOffset(0);
              showFlash(
                `Deleted report ${selectedReport.id.slice(0, 10)}`,
                'green',
              );
              void refreshSnapshot().catch(() => {});
            })
            .catch((error: unknown) => {
              const message = toErrorMessage(error);
              showFlash(`Delete failed: ${message}`, 'red');
            });
          return;
        }
        case 'activity:filter_next': {
          setActivityLevelFilter((current) => {
            switch (current) {
              case 'all':
                showFlash('Activity filter: info+', 'cyan');
                return 'info+';
              case 'info+':
                showFlash('Activity filter: warn+', 'cyan');
                return 'warn+';
              case 'warn+':
                showFlash('Activity filter: error', 'cyan');
                return 'error';
              case 'error':
                showFlash('Activity filter: all', 'cyan');
                return 'all';
            }
          });
          return;
        }
        case 'detail:toggle_mode': {
          if (viewMode !== 'reports' || !selectedReport) return;
          const isRunning =
            selectedReport.status === 'running' ||
            selectedReport.status === 'queued';
          if (isRunning) {
            showFlash('Session is live — cannot toggle', 'yellow');
            return;
          }
          setDetailMode((current) => {
            const next = current === 'findings' ? 'session' : 'findings';
            showFlash(`Detail: ${next}`, 'cyan');
            return next;
          });
          setDetailOffset(0);
          return;
        }
        case 'cursor:up': {
          if (viewMode === 'reports') {
            if (focusPane === 'detail') {
              setDetailOffset((offset) => Math.max(0, offset - 1));
            } else {
              setReportIndex((index) => Math.max(0, index - 1));
              setDetailOffset(0);
            }
            return;
          }
          if (viewMode === 'repos') {
            setRepoIndex((index) => Math.max(0, index - 1));
            return;
          }
          setEventOffset((offset) =>
            Math.min(filteredEvents.length, offset + 1),
          );
          return;
        }
        case 'cursor:down': {
          if (viewMode === 'reports') {
            if (focusPane === 'detail') {
              const findingsCount = currentDetail?.data.findings.length ?? 0;
              const maxOffset =
                detailMode === 'session'
                  ? Math.max(
                      0,
                      detailSessionLineCount - detailVisibleSessionLines,
                    )
                  : Math.max(0, findingsCount - 1);
              setDetailOffset((offset) => Math.min(maxOffset, offset + 1));
            } else {
              setReportIndex((index) =>
                Math.min(reports.length - 1, index + 1),
              );
              setDetailOffset(0);
            }
            return;
          }
          if (viewMode === 'repos') {
            setRepoIndex((index) => Math.min(repos.length - 1, index + 1));
            return;
          }
          setEventOffset((offset) => Math.max(0, offset - 1));
          return;
        }
        case 'cursor:open': {
          if (viewMode === 'reports') {
            setFocusPane('detail');
          }
          return;
        }
        case 'cursor:top': {
          if (viewMode === 'reports') setReportIndex(0);
          if (viewMode === 'repos') setRepoIndex(0);
          if (viewMode === 'activity') {
            setEventOffset(filteredEvents.length);
          }
          return;
        }
        case 'cursor:bottom': {
          if (viewMode === 'reports')
            setReportIndex(Math.max(0, reports.length - 1));
          if (viewMode === 'repos') setRepoIndex(Math.max(0, repos.length - 1));
          if (viewMode === 'activity') setEventOffset(0);
          return;
        }
        case 'detail:close': {
          setFocusPane('list');
          return;
        }
      }
    },
    [
      currentDetail,
      detailMode,
      detailSessionLineCount,
      detailVisibleSessionLines,
      filteredEvents.length,
      exit,
      focusPane,
      refreshSnapshot,
      repoIndex,
      repos,
      reports.length,
      selectedReport,
      showFlash,
      socketPath,
      viewMode,
    ],
  );

  useScopedKeymap(activeKeyScopes, handleAction, !agentPickerOpen);

  useEffect(() => {
    setReportIndex((index) => clamp(index, 0, Math.max(0, reports.length - 1)));
  }, [reports.length]);

  useEffect(() => {
    setRepoIndex((index) => clamp(index, 0, Math.max(0, repos.length - 1)));
  }, [repos.length]);

  const reposEnabled = repos.filter(
    (repo) => repo.enabled && !repo.paused,
  ).length;
  const runningJobs = repos.reduce((sum, repo) => sum + repo.runningJobs, 0);
  const queuedJobs = repos.reduce((sum, repo) => sum + repo.queuedJobs, 0);

  const reportWindowStart = clamp(
    reportIndex - Math.floor(visibleListRows / 2),
    0,
    Math.max(0, reports.length - visibleListRows),
  );

  const repoWindowRows = Math.max(8, termRows - 22);
  const repoWindowStart = clamp(
    repoIndex - Math.floor(repoWindowRows / 2),
    0,
    Math.max(0, repos.length - repoWindowRows),
  );

  const repoNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const repo of repos) {
      map[repo.id] = shortRepoName(repo.path);
    }
    return map;
  }, [repos]);

  const safeEventOffset = clamp(eventOffset, 0, filteredEvents.length);
  const eventEnd = Math.max(0, filteredEvents.length - safeEventOffset);
  const eventStart = Math.max(0, eventEnd - visibleEventRows);
  const visibleEvents = filteredEvents.slice(eventStart, eventEnd);

  useEffect(() => {
    setEventOffset((offset) => clamp(offset, 0, filteredEvents.length));
  }, [filteredEvents.length]);

  return (
    <Box flexDirection="column">
      <Header
        viewMode={viewMode}
        streamState={streamState}
        paused={paused}
        reposEnabled={reposEnabled}
        reposTotal={repos.length}
        runningJobs={runningJobs}
        queuedJobs={queuedJobs}
        reportsCount={reports.length}
        uptimeMs={daemon.uptimeMs}
        lastRefreshAgoMs={nowTs - lastRefreshTs}
      />

      <Box marginTop={1} flexDirection={isNarrow ? 'column' : 'row'}>
        {viewMode === 'reports' && (
          <ReportsView
            reports={reports}
            reportIndex={reportIndex}
            focusPane={focusPane}
            isNarrow={isNarrow}
            listPaneWidth={listPaneWidth}
            detailPaneWidth={detailPaneWidth}
            visibleListRows={visibleListRows}
            reportWindowStart={reportWindowStart}
            nowTs={nowTs}
            currentDetail={currentDetail}
            detailLoading={detailLoading}
            detailError={detailError}
            detailOffset={detailOffset}
            detailVisibleRows={detailVisibleFindings}
            sessionEvents={sessionEvents}
            detailMode={detailMode}
            historicalSessionEvents={historicalSessionEvents}
          />
        )}

        {viewMode === 'repos' && (
          <ReposView
            repos={repos}
            repoIndex={repoIndex}
            isNarrow={isNarrow}
            repoWindowStart={repoWindowStart}
            visibleRepoRows={repoWindowRows}
            termCols={termCols}
            nowTs={nowTs}
          />
        )}

        {viewMode === 'activity' && (
          <ActivityView
            events={filteredEvents}
            visibleEvents={visibleEvents}
            repoNameById={repoNameById}
            levelFilter={activityLevelFilter}
            termCols={termCols}
            scrollOffset={safeEventOffset}
          />
        )}
      </Box>

      <KeybindingsFooter
        viewMode={viewMode}
        focusPane={focusPane}
        showToggle={
          viewMode === 'reports' &&
          selectedReport != null &&
          selectedReport.status !== 'running' &&
          selectedReport.status !== 'queued'
        }
      />

      {agentPickerOpen && (
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          flexDirection="column"
        >
          <Text bold color="cyan">
            Select Agent
          </Text>
          <Text color="gray">
            Use j/k or arrows, Enter to confirm, Esc to cancel
          </Text>
          {AGENT_PICKER_OPTIONS.map((option, index) => {
            const selected = index === agentPickerIndex;
            return (
              <Text key={option.key} color={selected ? 'green' : undefined}>
                {selected ? '> ' : '  '}
                {option.label}
              </Text>
            );
          })}
        </Box>
      )}

      <StatusBar
        streamError={streamError}
        refreshError={refreshError}
        bufferedWhilePaused={bufferedWhilePaused}
        paused={paused}
        termWidth={termCols}
        flashMessage={flashMessage}
        flashTone={flashTone}
      />
    </Box>
  );
}
