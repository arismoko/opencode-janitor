import {
  useEffect,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';

const FOLLOW_ENABLE_PX = 48;
const FOLLOW_DISABLE_PX = 96;
const LARGE_JUMP_PX = 240;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

export function useSessionFollowMode({
  isSessionMode,
  selectedReportId,
  detailMode,
  latestSessionEventId,
  transcriptLength,
  detailScrollRef,
}) {
  const [unreadCount, setUnreadCount] = useState(0);
  const followModeRef = useRef(true);
  const scrollAnimationRef = useRef(0);
  const lastSessionCursorRef = useRef(0);

  const cancelScrollAnimation = () => {
    if (scrollAnimationRef.current) {
      cancelAnimationFrame(scrollAnimationRef.current);
      scrollAnimationRef.current = 0;
    }
  };

  const relockToBottom = () => {
    const element = detailScrollRef.current;
    if (!element) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight;
      });
    });
  };

  const animateScrollTo = (targetTop, onDone) => {
    const element = detailScrollRef.current;
    if (!element) return;

    cancelScrollAnimation();

    const start = element.scrollTop;
    const distance = targetTop - start;
    const duration = Math.min(420, Math.max(180, Math.abs(distance) * 0.25));
    const startAt = performance.now();

    const tick = (now) => {
      const elapsed = now - startAt;
      const progress = Math.min(1, elapsed / duration);
      element.scrollTop = start + distance * easeOutCubic(progress);
      if (progress < 1) {
        scrollAnimationRef.current = requestAnimationFrame(tick);
      } else {
        scrollAnimationRef.current = 0;
        onDone?.();
      }
    };

    scrollAnimationRef.current = requestAnimationFrame(tick);
  };

  const scrollToLatest = () => {
    const element = detailScrollRef.current;
    if (!element) return;
    const targetTop = element.scrollHeight;
    const distance = targetTop - element.scrollTop;

    if (Math.abs(distance) > LARGE_JUMP_PX) {
      animateScrollTo(targetTop, relockToBottom);
    } else {
      element.scrollTo({ top: targetTop, behavior: 'smooth' });
      relockToBottom();
    }

    followModeRef.current = true;
    setUnreadCount(0);
  };

  useEffect(() => {
    const element = detailScrollRef.current;
    if (!element || !isSessionMode) {
      followModeRef.current = true;
      return undefined;
    }

    const onScroll = () => {
      const remaining =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      if (remaining <= FOLLOW_ENABLE_PX) {
        followModeRef.current = true;
        setUnreadCount(0);
      } else if (remaining >= FOLLOW_DISABLE_PX) {
        followModeRef.current = false;
      }
    };

    onScroll();
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [isSessionMode, selectedReportId]);

  useEffect(() => {
    lastSessionCursorRef.current = 0;
    setUnreadCount(0);
    followModeRef.current = true;
    cancelScrollAnimation();
  }, [selectedReportId, detailMode]);

  useEffect(() => {
    if (!isSessionMode) return;

    const previousCursor = lastSessionCursorRef.current;
    if (latestSessionEventId <= previousCursor) return;
    lastSessionCursorRef.current = latestSessionEventId;

    if (followModeRef.current) {
      const element = detailScrollRef.current;
      if (!element) return;
      requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight;
        relockToBottom();
      });
      setUnreadCount(0);
      return;
    }

    setUnreadCount((count) => count + 1);
  }, [
    isSessionMode,
    detailMode,
    latestSessionEventId,
    transcriptLength,
    selectedReportId,
  ]);

  useEffect(
    () => () => {
      cancelScrollAnimation();
    },
    [],
  );

  return {
    unreadCount,
    scrollToLatest,
  };
}
