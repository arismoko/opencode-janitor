import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';

export function useRepoSelection(repos) {
  const [selectedRepoId, setSelectedRepoId] = useState(null);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [repoQuery, setRepoQuery] = useState('');
  const [repoHighlight, setRepoHighlight] = useState(0);

  const repoPickerRef = useRef(null);
  const repoInputRef = useRef(null);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.id === selectedRepoId) ?? repos[0] ?? null,
    [repos, selectedRepoId],
  );

  const repoOptions = useMemo(() => {
    if (!repoQuery.trim()) return repos;
    const needle = repoQuery.trim().toLowerCase();
    return repos.filter(
      (repo) =>
        (repo.path || '').toLowerCase().includes(needle) ||
        (repo.defaultBranch || '').toLowerCase().includes(needle),
    );
  }, [repos, repoQuery]);

  useEffect(() => {
    if (repos.length === 0) return;

    const persisted = localStorage.getItem('dashboard.selectedRepoId');
    if (persisted && repos.some((repo) => repo.id === persisted)) {
      setSelectedRepoId((current) => current ?? persisted);
      return;
    }

    setSelectedRepoId((current) => current ?? repos[0].id);
  }, [repos]);

  useEffect(() => {
    if (!selectedRepoId) return;
    localStorage.setItem('dashboard.selectedRepoId', selectedRepoId);
  }, [selectedRepoId]);

  useEffect(() => {
    if (!selectedRepoId) return;
    if (!repos.some((repo) => repo.id === selectedRepoId)) {
      setSelectedRepoId(repos[0]?.id ?? null);
    }
  }, [repos, selectedRepoId]);

  useEffect(() => {
    if (!repoPickerOpen) return;
    requestAnimationFrame(() => repoInputRef.current?.focus());
  }, [repoPickerOpen]);

  useEffect(() => {
    if (!repoPickerOpen) return;

    const onMouseDown = (event) => {
      if (!repoPickerRef.current?.contains(event.target)) {
        setRepoPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [repoPickerOpen]);

  const toggleRepoPicker = () => {
    setRepoPickerOpen((open) => !open);
    setRepoHighlight(0);
  };

  const updateRepoQuery = (value) => {
    setRepoQuery(value);
    setRepoHighlight(0);
  };

  const selectRepo = (repoId) => {
    setSelectedRepoId(repoId);
    setRepoPickerOpen(false);
    setRepoQuery('');
    setRepoHighlight(0);
  };

  const onRepoQueryKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setRepoPickerOpen(false);
      return;
    }

    if (repoOptions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setRepoHighlight((index) => (index + 1) % repoOptions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setRepoHighlight(
        (index) => (index - 1 + repoOptions.length) % repoOptions.length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectRepo(repoOptions[repoHighlight].id);
    }
  };

  return {
    selectedRepoId,
    selectedRepo,
    repoOptions,
    repoPickerOpen,
    repoQuery,
    repoHighlight,
    repoPickerRef,
    repoInputRef,
    setRepoHighlight,
    toggleRepoPicker,
    updateRepoQuery,
    selectRepo,
    onRepoQueryKeyDown,
  };
}
