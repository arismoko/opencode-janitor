import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';
import { api } from '../api.js';

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
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!selectedReport) {
      setDetail(null);
      return;
    }

    api(
      `/v1/dashboard/report?reviewRunId=${encodeURIComponent(selectedReport.id)}&findingsLimit=300`,
    )
      .then((data) => setDetail(data))
      .catch((error) => onErrorRef.current?.(error));
  }, [selectedReportId, reportsLength]);

  useEffect(() => {
    if (!selectedReport || detailMode !== 'session') return;

    const running =
      selectedReport.status === 'running' || selectedReport.status === 'queued';
    if (running) {
      setHistoricalSession([]);
      return;
    }

    api(
      `/v1/events?afterSeq=0&limit=500&reviewRunId=${encodeURIComponent(selectedReport.id)}`,
    )
      .then((data) => setHistoricalSession(data.events || []))
      .catch(() => setHistoricalSession([]));
  }, [selectedReportId, detailMode]);

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
  };
}
