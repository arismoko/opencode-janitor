import type { Finding } from '../types';

/** Lifecycle state of a finding across reviews */
export type FindingLifecycle = 'new' | 'persistent' | 'resolved' | 'regressed';

/** A finding with lifecycle annotation */
export interface AnnotatedFinding {
  finding: Finding;
  exactKey: string;
  scopedKey: string;
  lifecycle: FindingLifecycle;
  /** How many consecutive reviews this finding has appeared in */
  streak: number;
}

/** A stored review record */
export interface ReviewRecord {
  sha: string;
  subject: string;
  date: string; // ISO
  findings: Array<{
    exactKey: string;
    scopedKey: string;
    category: string;
    location: string;
  }>;
  findingCount: number;
  clean: boolean;
}

/** Active finding ledger entry — derived from reviews, not stored independently */
export interface FindingLedgerEntry {
  exactKey: string;
  scopedKey: string;
  category: string;
  location: string;
  firstSeenSha: string;
  lastSeenSha: string;
  occurrences: number;
  /** Consecutive reviews this finding has appeared in (resets on resolve) */
  consecutiveRuns: number;
  state: 'active' | 'resolved';
}

/** The history file structure */
export interface HistoryFile {
  version: 1;
  reviews: ReviewRecord[];
}
