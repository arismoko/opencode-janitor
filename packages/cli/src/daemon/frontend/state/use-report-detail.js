import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';
import { api } from '../api.js';

const ACTIVE_POLL_MS = 3000;

function isTerminal(status) {
  return status === 'succeeded' || status === 'failed';
}

function isActive(status) {
  return status === 'queued' || status === 'running';
}

export function useReportDetail({
  selectedReport,
  selectedReportId,
  reportsLength,
  detailMode,
  events,
  onError,
}) {
  const [detail, setDetail] = useState(null);
  const [historicalSession, setHistoricalSession] = useState([]);
  const [sessionPage, setSessionPage] = useState(0);
  const [sessionHasMore, setSessionHasMore] = useState(false);
  const onErrorRef = useRef(onError);

  // Track the status we last fetched detail for, so we can detect transitions.
  const lastFetchedStatusRef = useRef(null);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // ── Core detail fetch ────────────────────────────────────────────────────
  const fetchDetail = useCallback((report) => {
    if (!report) return;
    api(
      `/v1/dashboard/report?reviewRunId=${encodeURIComponent(report.id)}&findingsLimit=300`,
    )
      .then((data) => {
        setDetail(data);
        lastFetchedStatusRef.current = report.status;
      })
      .catch((error) => onErrorRef.current?.(error));
  }, []);

  // ── Initial fetch + refetch on report change ─────────────────────────────
  useEffect(() => {
    if (!selectedReport) {
      setDetail(null);
      lastFetchedStatusRef.current = null;
      return;
    }

    fetchDetail(selectedReport);
  }, [selectedReportId, reportsLength, fetchDetail]);

  // ── Status transition detection ──────────────────────────────────────────
  // When selectedReport.status changes (e.g. from snapshot polling) and a run
  // transitions from queued/running to succeeded/failed, refetch the detail
  // payload so findings are immediately available.
  useEffect(() => {
    if (!selectedReport) return;

    const prev = lastFetchedStatusRef.current;
    const curr = selectedReport.status;
    if (prev && isActive(prev) && isTerminal(curr)) {
      fetchDetail(selectedReport);
    }
  }, [selectedReport?.status, fetchDetail]);

  // ── Active-run polling ───────────────────────────────────────────────────
  // When the selected report is queued or running, poll for detail updates on
  // a short interval. This catches the transition even if the snapshot polling
  // hasn't picked it up yet. Stops automatically at terminal state.
  useEffect(() => {
    if (!selectedReport || !isActive(selectedReport.status)) return;

    const interval = setInterval(() => {
      fetchDetail(selectedReport);
    }, ACTIVE_POLL_MS);

    return () => clearInterval(interval);
  }, [selectedReportId, selectedReport?.status, fetchDetail]);

  // ── Findings-tab freshness ───────────────────────────────────────────────
  // When switching to 'findings' mode, if the detail was last fetched for an
  // active status and the report has since completed, refetch to pick up
  // findings that weren't available before.
  useEffect(() => {
    if (!selectedReport || detailMode !== 'findings') return;

    const lastStatus = lastFetchedStatusRef.current;
    if (
      lastStatus &&
      isActive(lastStatus) &&
      isTerminal(selectedReport.status)
    ) {
      fetchDetail(selectedReport);
    }
  }, [detailMode, selectedReport?.status, fetchDetail]);

  // ── Historical session events ────────────────────────────────────────────
  const SESSION_PAGE_SIZE = 500;

  useEffect(() => {
    const isSessionMode =
      detailMode === 'session' || detailMode === 'session-raw';
    if (!selectedReport || !isSessionMode) return;

    if (isActive(selectedReport.status)) {
      setHistoricalSession([]);
      setSessionPage(0);
      setSessionHasMore(false);
      return;
    }

    api(
      `/v1/events?afterSeq=0&limit=${SESSION_PAGE_SIZE}&reviewRunId=${encodeURIComponent(selectedReport.id)}`,
    )
      .then((data) => {
        const fetched = data.events || [];
        setHistoricalSession(fetched);
        setSessionPage(1);
        setSessionHasMore(fetched.length >= SESSION_PAGE_SIZE);
      })
      .catch(() => {
        setHistoricalSession([]);
        setSessionPage(0);
        setSessionHasMore(false);
      });
  }, [selectedReportId, detailMode]);

  const loadMoreSessionEvents = useCallback(() => {
    if (!selectedReport || !sessionHasMore) return;

    const afterSeq =
      historicalSession.length > 0
        ? historicalSession[historicalSession.length - 1].eventId
        : 0;

    api(
      `/v1/events?afterSeq=${afterSeq}&limit=${SESSION_PAGE_SIZE}&reviewRunId=${encodeURIComponent(selectedReport.id)}`,
    )
      .then((data) => {
        const fetched = data.events || [];
        setHistoricalSession((prev) => [...prev, ...fetched]);
        setSessionPage((p) => p + 1);
        setSessionHasMore(fetched.length >= SESSION_PAGE_SIZE);
      })
      .catch(() => setSessionHasMore(false));
  }, [selectedReport, historicalSession, sessionHasMore]);

  // ── Session events merge ─────────────────────────────────────────────────
  const sessionEvents = useMemo(() => {
    if (!selectedReport) return [];

    const inMemory = events.filter(
      (event) =>
        event.topic?.startsWith('session.') &&
        (event.reviewRunId === selectedReport.id ||
          (selectedReport.sessionId &&
            event.sessionId === selectedReport.sessionId)),
    );

    return inMemory.length > 0 ? inMemory : historicalSession;
  }, [events, selectedReport, historicalSession]);

  // ── Transcript (legacy flat text fallback) ───────────────────────────────
  const transcript = useMemo(() => {
    const lines = [];

    for (const event of sessionEvents) {
      if (event.topic === 'session.delta') {
        lines.push(
          typeof event.payload?.delta === 'string'
            ? event.payload.delta
            : event.message || '',
        );
      } else if (String(event.topic || '').startsWith('session.')) {
        lines.push(
          `\n--- ${String(event.topic).replace('session.', '').toUpperCase()}: ${event.message || ''} ---\n`,
        );
      }
    }

    return lines.join('');
  }, [sessionEvents]);

  return {
    detail,
    setDetail,
    sessionEvents,
    transcript,
    sessionHasMore,
    loadMoreSessionEvents,
  };
}
