import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'https://esm.sh/preact@10.26.2/hooks';

export function useReportSelection({ reports, selectedRepoId }) {
  const [selectedReportId, setSelectedReportId] = useState(null);
  const previousReportsRef = useRef(reports);

  const filteredReports = useMemo(
    () =>
      selectedRepoId
        ? reports.filter((report) => report.repoId === selectedRepoId)
        : reports,
    [reports, selectedRepoId],
  );

  const selectedReport = useMemo(
    () =>
      filteredReports.find((report) => report.id === selectedReportId) ??
      filteredReports[0] ??
      null,
    [filteredReports, selectedReportId],
  );

  useEffect(() => {
    if (previousReportsRef.current === reports) {
      return;
    }

    previousReportsRef.current = reports;
    setSelectedReportId((current) => current ?? reports[0]?.id ?? null);
  }, [reports]);

  useEffect(() => {
    if (!selectedRepoId) return;

    if (
      filteredReports.length > 0 &&
      !filteredReports.some((report) => report.id === selectedReportId)
    ) {
      setSelectedReportId(filteredReports[0].id);
    }

    if (filteredReports.length === 0) {
      setSelectedReportId(null);
    }
  }, [selectedRepoId, filteredReports, selectedReportId]);

  return {
    selectedReportId,
    setSelectedReportId,
    filteredReports,
    selectedReport,
  };
}
