import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';
import { api } from '../api.js';

const ACTIVE_POLL_MS = 3000;
const SESSION_PAGE_SIZE = 500;
const TEXT_SETTLE_MS = 1000;

function isTerminal(status) {
  return status === 'succeeded' || status === 'failed';
}

function isActive(status) {
  return status === 'queued' || status === 'running';
}

function toolEventKey(event) {
  const payload = event?.payload || {};
  if (typeof payload.callId === 'string' && payload.callId.length > 0) {
    return `call:${payload.callId}`;
  }
  if (typeof payload.partId === 'string' && payload.partId.length > 0) {
    return `part:${payload.partId}`;
  }
  if (typeof event?.eventId === 'number') {
    return `event:${event.eventId}`;
  }
  return null;
}

export function useReportDetail({
  isReportsView,
  selectedReport,
  selectedReportId,
  detailMode,
  events,
  onError,
}) {
  const [detail, setDetail] = useState(null);
  const [historicalSession, setHistoricalSession] = useState([]);
  const [sessionHasMore, setSessionHasMore] = useState(false);
  const [timelineBlocks, setTimelineBlocks] = useState([]);
  const onErrorRef = useRef(onError);

  const seenEventIdsRef = useRef(new Set());
  const deltaBlockIndexByPartIdRef = useRef(new Map());
  const toolBlockIndexByKeyRef = useRef(new Map());
  const settleTimersByPartIdRef = useRef(new Map());
  const timelineBlocksRef = useRef([]);
  const lastFetchedStatusRef = useRef(null);
  const lastAppliedEventIdRef = useRef(0);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    timelineBlocksRef.current = timelineBlocks;
  }, [timelineBlocks]);

  const resetTimelineState = useCallback(() => {
    for (const timer of settleTimersByPartIdRef.current.values()) {
      clearTimeout(timer);
    }
    settleTimersByPartIdRef.current.clear();
    seenEventIdsRef.current = new Set();
    deltaBlockIndexByPartIdRef.current = new Map();
    toolBlockIndexByKeyRef.current = new Map();
    lastAppliedEventIdRef.current = 0;
    timelineBlocksRef.current = [];
    setTimelineBlocks([]);
  }, []);

  const setTextSettleTimer = useCallback((partId) => {
    if (!partId) return;
    const existing = settleTimersByPartIdRef.current.get(partId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      settleTimersByPartIdRef.current.delete(partId);
      const index = deltaBlockIndexByPartIdRef.current.get(partId);
      if (typeof index !== 'number') return;

      setTimelineBlocks((previous) => {
        if (index < 0 || index >= previous.length) return previous;
        const block = previous[index];
        if (!block || block.type !== 'text' || !block.isStreaming) {
          return previous;
        }
        const next = [...previous];
        next[index] = { ...block, isStreaming: false };
        timelineBlocksRef.current = next;
        return next;
      });
    }, TEXT_SETTLE_MS);

    settleTimersByPartIdRef.current.set(partId, timer);
  }, []);

  const applySessionEventBatch = useCallback(
    (batch) => {
      if (!Array.isArray(batch) || batch.length === 0) return;

      setTimelineBlocks((previous) => {
        const next = [...previous];

        const appendEventBlock = (event) => {
          next.push({ type: 'event', event });
        };

        const appendOrMergeDeltaBlock = (event) => {
          const payload = event.payload || {};
          const delta =
            typeof payload.delta === 'string'
              ? payload.delta
              : event.message || '';
          if (!delta) return;

          const partId =
            typeof payload.partId === 'string' && payload.partId.length > 0
              ? payload.partId
              : null;
          const blockKey = partId || `delta:${event.eventId}`;
          const hasStablePartId = Boolean(partId);
          const existingIndex =
            deltaBlockIndexByPartIdRef.current.get(blockKey);

          if (typeof existingIndex === 'number') {
            const current = next[existingIndex];
            if (current && current.type === 'text') {
              next[existingIndex] = {
                ...current,
                text: `${current.text}${delta}`,
                eventId: event.eventId,
                ts: event.ts,
                isStreaming: true,
              };
            }
          } else {
            next.push({
              type: 'text',
              partId: blockKey,
              text: delta,
              isStreaming: true,
              eventId: event.eventId,
              ts: event.ts,
            });
            deltaBlockIndexByPartIdRef.current.set(blockKey, next.length - 1);
          }

          if (!hasStablePartId) {
            setTextSettleTimer(blockKey);
          }
        };

        const finalizeTextPart = (event) => {
          const payload = event.payload || {};
          const finalText =
            typeof payload.text === 'string'
              ? payload.text
              : event.message || '';
          if (!finalText) return;

          const partId =
            typeof payload.partId === 'string' && payload.partId.length > 0
              ? payload.partId
              : null;
          const blockKey = partId || `text:${event.eventId}`;
          const existingIndex =
            deltaBlockIndexByPartIdRef.current.get(blockKey);

          if (typeof existingIndex === 'number') {
            const current = next[existingIndex];
            if (current && current.type === 'text') {
              next[existingIndex] = {
                ...current,
                text: finalText,
                eventId: event.eventId,
                ts: event.ts,
                isStreaming: false,
              };
            }
          } else {
            next.push({
              type: 'text',
              partId: blockKey,
              text: finalText,
              isStreaming: false,
              eventId: event.eventId,
              ts: event.ts,
            });
            deltaBlockIndexByPartIdRef.current.set(blockKey, next.length - 1);
          }

          const timer = settleTimersByPartIdRef.current.get(blockKey);
          if (timer) {
            clearTimeout(timer);
            settleTimersByPartIdRef.current.delete(blockKey);
          }
        };

        const upsertToolBlock = (event) => {
          const key = toolEventKey(event);
          if (!key) {
            next.push({
              type: 'tool-call',
              key: `tool:${event.eventId}`,
              event,
            });
            return;
          }

          const existingIndex = toolBlockIndexByKeyRef.current.get(key);
          if (typeof existingIndex === 'number') {
            const existing = next[existingIndex];
            if (existing && existing.type === 'tool-call') {
              next[existingIndex] = { ...existing, event };
              return;
            }
          }

          next.push({ type: 'tool-call', key, event });
          toolBlockIndexByKeyRef.current.set(key, next.length - 1);
        };

        for (const event of batch) {
          if (!event || typeof event.eventId !== 'number') continue;
          if (seenEventIdsRef.current.has(event.eventId)) continue;
          seenEventIdsRef.current.add(event.eventId);

          const topic = String(event.topic || '');
          if (topic === 'session.delta') {
            appendOrMergeDeltaBlock(event);
            continue;
          }
          if (topic === 'session.text') {
            finalizeTextPart(event);
            continue;
          }
          if (topic.startsWith('session.tool.')) {
            upsertToolBlock(event);
            continue;
          }
          appendEventBlock(event);
        }

        timelineBlocksRef.current = next;
        return next;
      });
    },
    [setTextSettleTimer],
  );

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

  useEffect(() => {
    if (!selectedReport) {
      setDetail(null);
      lastFetchedStatusRef.current = null;
      resetTimelineState();
      return;
    }

    resetTimelineState();
    fetchDetail(selectedReport);
  }, [selectedReportId, fetchDetail, resetTimelineState]);

  useEffect(() => {
    if (!selectedReport) return;

    const prev = lastFetchedStatusRef.current;
    const curr = selectedReport.status;
    if (prev && isActive(prev) && isTerminal(curr)) {
      fetchDetail(selectedReport);
    }
  }, [selectedReport?.status, fetchDetail]);

  useEffect(() => {
    if (!selectedReport || !isActive(selectedReport.status)) return;

    const interval = setInterval(() => {
      fetchDetail(selectedReport);
    }, ACTIVE_POLL_MS);

    return () => clearInterval(interval);
  }, [selectedReportId, selectedReport?.status, fetchDetail]);

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

  useEffect(() => {
    const isSessionMode =
      detailMode === 'session' || detailMode === 'session-raw';
    if (!isReportsView || !selectedReport || !isSessionMode) return;

    if (isActive(selectedReport.status)) {
      setHistoricalSession([]);
      setSessionHasMore(false);
      return;
    }

    api(
      `/v1/events?afterSeq=0&limit=${SESSION_PAGE_SIZE}&reviewRunId=${encodeURIComponent(selectedReport.id)}`,
    )
      .then((data) => {
        const fetched = data.events || [];
        setHistoricalSession(fetched);
        setSessionHasMore(fetched.length >= SESSION_PAGE_SIZE);
      })
      .catch(() => {
        setHistoricalSession([]);
        setSessionHasMore(false);
      });
  }, [isReportsView, selectedReportId, detailMode]);

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
        setSessionHasMore(fetched.length >= SESSION_PAGE_SIZE);
      })
      .catch(() => setSessionHasMore(false));
  }, [selectedReport, historicalSession, sessionHasMore]);

  const sessionEvents = useMemo(() => {
    if (!isReportsView || !selectedReport) return [];

    const inMemory = events.filter(
      (event) =>
        event.topic?.startsWith('session.') &&
        (event.reviewRunId === selectedReport.id ||
          (selectedReport.sessionId &&
            event.sessionId === selectedReport.sessionId)),
    );

    return inMemory.length > 0 ? inMemory : historicalSession;
  }, [isReportsView, events, selectedReport, historicalSession]);

  useEffect(() => {
    if (!isReportsView || detailMode !== 'session') return;
    if (!selectedReport || sessionEvents.length === 0) return;

    const lastApplied = lastAppliedEventIdRef.current;
    const nextBatch = [];
    let nextMax = lastApplied;

    for (const event of sessionEvents) {
      const eventId = typeof event?.eventId === 'number' ? event.eventId : 0;
      if (eventId <= lastApplied) continue;
      nextBatch.push(event);
      if (eventId > nextMax) {
        nextMax = eventId;
      }
    }

    if (nextBatch.length === 0) return;
    applySessionEventBatch(nextBatch);
    lastAppliedEventIdRef.current = nextMax;
  }, [
    isReportsView,
    detailMode,
    selectedReportId,
    sessionEvents,
    applySessionEventBatch,
    selectedReport,
  ]);

  const transcript = useMemo(() => {
    if (!isReportsView || detailMode !== 'session-raw') {
      return '';
    }

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
  }, [isReportsView, detailMode, sessionEvents]);

  return {
    detail,
    setDetail,
    sessionEvents,
    timelineBlocks,
    transcript,
    sessionHasMore,
    loadMoreSessionEvents,
  };
}
