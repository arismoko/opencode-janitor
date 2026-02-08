import type { FindingCategory } from '../types';

/** A suppressed finding entry */
export interface Suppression {
  /** High-precision key: category|suffix2|shapeHash|evidenceHash */
  exactKey: string;
  /** Rename-tolerant key: category|filename|shapeHash */
  scopedKey: string;
  /** Which tier was used to create this */
  tier: 'exact' | 'scoped';
  /** Human-readable reason (optional) */
  reason?: string;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when last matched against a finding */
  lastSeenAt: string;
  /** TTL in days — expires after this many days without being seen */
  ttlDays: number;
  /** Original finding data for display */
  original: {
    category: FindingCategory;
    location: string;
    evidence: string;
    prescription: string;
    sha: string;
  };
}

export interface SuppressionsFile {
  version: 1;
  suppressions: Suppression[];
}
