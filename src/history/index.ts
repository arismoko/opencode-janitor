export { analyzeLifecycle, detectResolved } from './analyzer';
export {
  buildHistorySection,
  type EnrichmentData,
  enrichToastMessage,
} from './enrichment';
export { HistoryStore } from './store';
export {
  type CategoryTrend,
  computeTrends,
  type TrendData,
  type TrendDirection,
} from './trends';
export type {
  AnnotatedFinding,
  FindingLedgerEntry,
  FindingLifecycle,
  HistoryFile,
  ReviewRecord,
} from './types';
