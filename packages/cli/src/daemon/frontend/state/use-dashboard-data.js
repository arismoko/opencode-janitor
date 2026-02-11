import {
  useEffect,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';
import { api } from '../api.js';
import { mergeEvents } from '../helpers.js';

export function useDashboardData(options = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const [events, setEvents] = useState([]);
  const [latestSeq, setLatestSeq] = useState(0);
  const [streamState, setStreamState] = useState('connecting');

  const reconnectRef = useRef(500);
  const latestSeqRef = useRef(0);
  const onSnapshotRef = useRef(options.onSnapshot);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onSnapshotRef.current = options.onSnapshot;
  }, [options.onSnapshot]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  const refreshSnapshot = async () => {
    const data = await api(
      '/v1/dashboard/snapshot?eventsLimit=120&reportsLimit=60',
    );
    setSnapshot(data);
    setEvents((previous) => mergeEvents(previous, data.events));
    setLatestSeq((sequence) => {
      const next = Math.max(sequence, data.latestSeq);
      latestSeqRef.current = next;
      return next;
    });
    onSnapshotRef.current?.(data);
  };

  useEffect(() => {
    let stop = false;

    refreshSnapshot().catch((error) => {
      onErrorRef.current?.(error);
    });

    const refresh = setInterval(() => {
      refreshSnapshot().catch(() => {});
    }, 4000);

    const connect = () => {
      if (stop) return;

      setStreamState('connecting');
      const stream = new EventSource(
        `/v1/events/stream?afterSeq=${latestSeqRef.current}`,
      );

      stream.addEventListener('ready', (event) => {
        setStreamState('live');
        reconnectRef.current = 500;
        const payload = JSON.parse(event.data);
        if (typeof payload.afterSeq === 'number') {
          setLatestSeq((sequence) => {
            const next = Math.max(sequence, payload.afterSeq);
            latestSeqRef.current = next;
            return next;
          });
        }
      });

      stream.addEventListener('heartbeat', () => {
        setStreamState('live');
      });

      stream.addEventListener('event', (event) => {
        setStreamState('live');
        const payload = JSON.parse(event.data);
        setLatestSeq((sequence) => {
          const next = Math.max(sequence, payload.eventId || 0);
          latestSeqRef.current = next;
          return next;
        });
        setEvents((previous) => mergeEvents(previous, [payload]));
      });

      stream.onerror = () => {
        stream.close();
        if (stop) return;

        setStreamState('error');
        const delay = reconnectRef.current;
        reconnectRef.current = Math.min(5000, reconnectRef.current * 2);
        setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      stop = true;
      clearInterval(refresh);
    };
  }, []);

  const clearEvents = () => {
    setEvents([]);
    setLatestSeq(0);
    latestSeqRef.current = 0;
  };

  return {
    snapshot,
    events,
    latestSeq,
    streamState,
    refreshSnapshot,
    clearEvents,
  };
}
