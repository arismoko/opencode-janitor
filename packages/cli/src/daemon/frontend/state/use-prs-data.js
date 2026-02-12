import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';
import { api } from '../api.js';

const DEFAULT_BUCKET = 'all-open';
const LIST_LIMIT = 80;

function encode(value) {
  return encodeURIComponent(String(value));
}

function dedupeStrings(values) {
  return [
    ...new Set((values || []).filter((value) => typeof value === 'string')),
  ];
}

function makeTempId() {
  return -Date.now();
}

export function usePrsData({ isPrsView, selectedRepo, onError }) {
  const [bucket, setBucket] = useState(DEFAULT_BUCKET);
  const [query, setQuery] = useState('');
  const [list, setList] = useState([]);
  const [selectedPrNumber, setSelectedPrNumber] = useState(null);
  const [detail, setDetail] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const repoOrId = selectedRepo?.id || null;

  const refreshList = useCallback(async () => {
    if (!repoOrId) {
      setList([]);
      setSelectedPrNumber(null);
      return [];
    }

    setListLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('repoOrId', repoOrId);
      params.set('bucket', bucket);
      params.set('limit', String(LIST_LIMIT));
      const trimmedQuery = query.trim();
      if (trimmedQuery) {
        params.set('query', trimmedQuery);
      }

      const response = await api(`/v1/prs/list?${params.toString()}`);
      const nextList = Array.isArray(response.items) ? response.items : [];
      setList(nextList);
      setSelectedPrNumber((current) => {
        if (nextList.length === 0) return null;
        if (current && nextList.some((item) => item.number === current)) {
          return current;
        }
        return nextList[0].number;
      });
      return nextList;
    } catch (error) {
      onErrorRef.current?.(error);
      return [];
    } finally {
      setListLoading(false);
    }
  }, [repoOrId, bucket, query]);

  const refreshDetail = useCallback(
    async (prNumber = selectedPrNumber) => {
      if (!repoOrId || !prNumber) {
        setDetail(null);
        return null;
      }
      setDetailLoading(true);
      try {
        const response = await api(
          `/v1/prs/detail?repoOrId=${encode(repoOrId)}&prNumber=${encode(prNumber)}`,
        );
        setDetail(response.detail || null);
        return response.detail || null;
      } catch (error) {
        onErrorRef.current?.(error);
        return null;
      } finally {
        setDetailLoading(false);
      }
    },
    [repoOrId, selectedPrNumber],
  );

  useEffect(() => {
    if (!isPrsView) return;
    refreshList().catch(() => {});
  }, [isPrsView, repoOrId, bucket, query, refreshList]);

  useEffect(() => {
    if (!isPrsView) return;
    refreshDetail().catch(() => {});
  }, [isPrsView, repoOrId, selectedPrNumber, refreshDetail]);

  const selectedSummary = useMemo(
    () => list.find((item) => item.number === selectedPrNumber) || null,
    [list, selectedPrNumber],
  );

  const reconcile = useCallback(async () => {
    await Promise.all([refreshList(), refreshDetail()]);
  }, [refreshList, refreshDetail]);

  const mergePr = useCallback(
    async (method = 'merge') => {
      if (!repoOrId || !selectedPrNumber) return;
      setList((previous) =>
        previous.map((item) =>
          item.number === selectedPrNumber
            ? { ...item, state: 'MERGED', mergeable: 'MERGED' }
            : item,
        ),
      );
      setDetail((previous) =>
        previous && previous.number === selectedPrNumber
          ? { ...previous, merged: true, state: 'MERGED', mergeable: 'MERGED' }
          : previous,
      );

      try {
        await api('/v1/prs/merge', {
          method: 'POST',
          body: JSON.stringify({
            repoOrId,
            prNumber: selectedPrNumber,
            method,
          }),
        });
      } finally {
        await reconcile();
      }
    },
    [repoOrId, selectedPrNumber, reconcile],
  );

  const addComment = useCallback(
    async (body) => {
      if (!repoOrId || !selectedPrNumber) return;
      const now = new Date().toISOString();
      const tempComment = {
        id: makeTempId(),
        authorLogin: 'you',
        body,
        createdAt: now,
        updatedAt: now,
        url: '',
      };
      setDetail((previous) =>
        previous && previous.number === selectedPrNumber
          ? {
              ...previous,
              issueComments: [...(previous.issueComments || []), tempComment],
            }
          : previous,
      );

      try {
        await api('/v1/prs/comment', {
          method: 'POST',
          body: JSON.stringify({ repoOrId, prNumber: selectedPrNumber, body }),
        });
      } finally {
        await reconcile();
      }
    },
    [repoOrId, selectedPrNumber, reconcile],
  );

  const requestReviewers = useCallback(
    async (reviewers) => {
      if (!repoOrId || !selectedPrNumber) return;
      const uniqueReviewers = dedupeStrings(
        reviewers.map((value) => value.trim()),
      );
      if (uniqueReviewers.length === 0) return;

      setList((previous) =>
        previous.map((item) =>
          item.number === selectedPrNumber
            ? {
                ...item,
                requestedReviewers: dedupeStrings([
                  ...(item.requestedReviewers || []),
                  ...uniqueReviewers,
                ]),
              }
            : item,
        ),
      );
      setDetail((previous) =>
        previous && previous.number === selectedPrNumber
          ? {
              ...previous,
              requestedReviewers: dedupeStrings([
                ...(previous.requestedReviewers || []),
                ...uniqueReviewers,
              ]),
            }
          : previous,
      );

      try {
        await api('/v1/prs/request-reviewers', {
          method: 'POST',
          body: JSON.stringify({
            repoOrId,
            prNumber: selectedPrNumber,
            reviewers: uniqueReviewers,
          }),
        });
      } finally {
        await reconcile();
      }
    },
    [repoOrId, selectedPrNumber, reconcile],
  );

  const replyToComment = useCallback(
    async (commentId, body) => {
      if (!repoOrId || !selectedPrNumber) return;
      const now = new Date().toISOString();
      const tempReply = {
        id: makeTempId(),
        inReplyToId: commentId,
        authorLogin: 'you',
        body,
        path: null,
        line: null,
        url: '',
        createdAt: now,
        updatedAt: now,
      };

      setDetail((previous) =>
        previous && previous.number === selectedPrNumber
          ? {
              ...previous,
              reviewComments: [...(previous.reviewComments || []), tempReply],
            }
          : previous,
      );

      try {
        await api('/v1/prs/reply-comment', {
          method: 'POST',
          body: JSON.stringify({
            repoOrId,
            prNumber: selectedPrNumber,
            commentId,
            body,
          }),
        });
      } finally {
        await reconcile();
      }
    },
    [repoOrId, selectedPrNumber, reconcile],
  );

  const enqueueAgentReview = useCallback(
    async ({ agent, note, focusPath }) => {
      if (!repoOrId || !selectedPrNumber) {
        throw new Error('Select a pull request before triggering review');
      }
      const trimmedNote = typeof note === 'string' ? note.trim() : '';
      const trimmedFocusPath =
        typeof focusPath === 'string' ? focusPath.trim() : '';

      return api('/v1/reviews/enqueue', {
        method: 'POST',
        body: JSON.stringify({
          repoOrId,
          agent,
          scope: 'pr',
          input: { prNumber: selectedPrNumber },
          ...(trimmedNote ? { note: trimmedNote } : {}),
          ...(trimmedFocusPath ? { focusPath: trimmedFocusPath } : {}),
        }),
      });
    },
    [repoOrId, selectedPrNumber],
  );

  return {
    bucket,
    setBucket,
    query,
    setQuery,
    list,
    selectedPrNumber,
    setSelectedPrNumber,
    selectedSummary,
    detail,
    listLoading,
    detailLoading,
    refreshList,
    refreshDetail,
    mergePr,
    addComment,
    requestReviewers,
    replyToComment,
    enqueueAgentReview,
  };
}
