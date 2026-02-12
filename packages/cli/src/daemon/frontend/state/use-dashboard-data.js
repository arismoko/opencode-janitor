import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';
import { api } from '../api.js';
import { mergeEvents } from '../helpers.js';

const FAST_POLL_MS = 4000;
const LIVE_POLL_MS = 30000;
const FLUSH_FALLBACK_MS = 64;

export function useDashboardData(options = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const [events, setEvents] = useState([]);
  const [latestSeq, setLatestSeq] = useState(0);
  const [streamState, setStreamState] = useState('connecting');

  const reconnectRef = useRef(500);
  const latestSeqRef = useRef(0);
  const streamStateRef = useRef('connecting');
  const onSnapshotRef = useRef(options.onSnapshot);
  const onErrorRef = useRef(options.onError);

  const pendingEventsRef = useRef([]);
  const flushRafRef = useRef(0);
  const flushTimerRef = useRef(0);
  const lastFlushAtRef = useRef(0);

  useEffect(() => {
    onSnapshotRef.current = options.onSnapshot;
  }, [options.onSnapshot]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  const setStreamStateSafe = useCallback((next) => {
    streamStateRef.current = next;
    setStreamState(next);
  }, []);

  const flushPendingEvents = useCallback(() => {
    if (flushRafRef.current) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = 0;
    }
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = 0;
    }

    const batch = pendingEventsRef.current;
    if (batch.length === 0) {
      return;
    }

    pendingEventsRef.current = [];
    lastFlushAtRef.current = Date.now();

    setEvents((previous) => mergeEvents(previous, batch));

    let batchMaxId = 0;
    for (const event of batch) {
      if (typeof event?.eventId === 'number' && event.eventId > batchMaxId) {
        batchMaxId = event.eventId;
      }
    }

    if (batchMaxId > 0) {
      setLatestSeq((sequence) => {
        const next = Math.max(sequence, batchMaxId);
        latestSeqRef.current = next;
        return next;
      });
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!flushRafRef.current) {
      flushRafRef.current = requestAnimationFrame(() => {
        flushRafRef.current = 0;
        flushPendingEvents();
      });
    }
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = 0;
        flushPendingEvents();
      }, FLUSH_FALLBACK_MS);
    }
  }, [flushPendingEvents]);

  const enqueueIncomingEvent = useCallback(
    (payload) => {
      if (!payload) return;
      pendingEventsRef.current.push(payload);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const refreshSnapshot = useCallback(async () => {
    const data = await api(
      '/v1/dashboard/snapshot?eventsLimit=120&reportsLimit=60',
    );
    setSnapshot(data);
    if (Array.isArray(data.events) && data.events.length > 0) {
      setEvents((previous) => mergeEvents(previous, data.events));
    }
    setLatestSeq((sequence) => {
      const next = Math.max(sequence, data.latestSeq || 0);
      latestSeqRef.current = next;
      return next;
    });
    onSnapshotRef.current?.(data);
  }, []);

  useEffect(() => {
    let stop = false;
    let pollTimer = 0;
    let reconnectTimer = 0;
    let stream = null;

    const clearTimers = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = 0;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = 0;
      }
    };

    const pollDelay = () =>
      streamStateRef.current === 'live' ? LIVE_POLL_MS : FAST_POLL_MS;

    const schedulePoll = (delay) => {
      if (stop) return;
      clearTimeout(pollTimer);
      pollTimer = setTimeout(async () => {
        if (stop) return;
        try {
          await refreshSnapshot();
        } catch {
          // best-effort anti-entropy poll
        }
        schedulePoll(pollDelay());
      }, delay);
    };

    const connect = () => {
      if (stop) return;

      setStreamStateSafe('connecting');
      stream = new EventSource(
        `/v1/events/stream?afterSeq=${latestSeqRef.current}`,
      );

      stream.addEventListener('ready', (event) => {
        setStreamStateSafe('live');
        reconnectRef.current = 500;
        try {
          const payload = JSON.parse(event.data);
          if (typeof payload.afterSeq === 'number') {
            setLatestSeq((sequence) => {
              const next = Math.max(sequence, payload.afterSeq);
              latestSeqRef.current = next;
              return next;
            });
          }
        } catch {
          // ignore malformed ready payloads
        }

        refreshSnapshot().catch(() => {});
        schedulePoll(LIVE_POLL_MS);
      });

      stream.addEventListener('heartbeat', () => {
        setStreamStateSafe('live');
      });

      stream.addEventListener('event', (event) => {
        setStreamStateSafe('live');
        try {
          enqueueIncomingEvent(JSON.parse(event.data));
        } catch {
          // ignore malformed stream events
        }
      });

      stream.onerror = () => {
        stream?.close();
        stream = null;
        if (stop) return;

        setStreamStateSafe('error');
        refreshSnapshot().catch(() => {});
        schedulePoll(FAST_POLL_MS);

        const delay = reconnectRef.current;
        reconnectRef.current = Math.min(5000, reconnectRef.current * 2);
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    refreshSnapshot().catch((error) => {
      onErrorRef.current?.(error);
    });
    schedulePoll(FAST_POLL_MS);
    connect();

    return () => {
      stop = true;
      clearTimers();
      stream?.close();
      if (flushRafRef.current) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = 0;
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = 0;
      }
      pendingEventsRef.current = [];
    };
  }, [
    enqueueIncomingEvent,
    flushPendingEvents,
    refreshSnapshot,
    setStreamStateSafe,
  ]);

  const clearLocalEvents = () => {
    setEvents([]);
    setLatestSeq(0);
    latestSeqRef.current = 0;
    pendingEventsRef.current = [];
  };

  const clearEvents = useCallback(async () => {
    const response = await api('/v1/events', { method: 'DELETE' });
    clearLocalEvents();
    return typeof response?.deleted === 'number' ? response.deleted : 0;
  }, []);

  return {
    snapshot,
    events,
    latestSeq,
    streamState,
    refreshSnapshot,
    clearEvents,
  };
}
