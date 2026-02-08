/**
 * Core domain types for opencode-janitor.
 * No internal imports — this is the leaf dependency.
 */

/** Canonical list of finding categories — single source of truth */
export const FINDING_CATEGORIES = ['DRY', 'DEAD', 'STRUCTURAL'] as const;

/** Category of structural issue (derived from FINDING_CATEGORIES) */
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/** Pipe-separated category string for use in prompt output format instructions */
export const CATEGORY_PIPE_STR = FINDING_CATEGORIES.join(' | ');

/** Canonical reviewer severity guide — single source of truth for P0-P3 descriptions */
export const REVIEWER_SEVERITY_GUIDE = [
  'P0: Must fix before merge — correctness bugs, security holes, data loss risks',
  'P1: Should fix before merge — performance regressions, architectural violations, missing error handling',
  'P2: Fix soon — code quality, maintainability, minor edge cases',
  'P3: Nice to have — style nits, minor improvements, documentation gaps',
] as const;

/** Allowed severity levels for reviewer findings (derived from REVIEWER_SEVERITY_GUIDE) */
export const REVIEWER_SEVERITIES = REVIEWER_SEVERITY_GUIDE.map(
  (s) => s.split(':')[0] as 'P0' | 'P1' | 'P2' | 'P3',
);

/** Severity level type for reviewer findings */
export type ReviewerSeverity = 'P0' | 'P1' | 'P2' | 'P3';

/** Allowed domain categories for reviewer findings */
export const REVIEWER_DOMAINS = [
  'BUG',
  'SECURITY',
  'PERFORMANCE',
  'ARCHITECTURE',
  'DOCS',
  'SPEC',
] as const;

/** Domain category type for reviewer findings */
export type ReviewerDomain = (typeof REVIEWER_DOMAINS)[number];

/** A single finding from the code reviewer agent */
export interface ReviewerFinding {
  location: string;
  severity: ReviewerSeverity;
  domain: ReviewerDomain;
  evidence: string;
  prescription: string;
}

/** Parsed reviewer result */
export interface ReviewerResult {
  id: string;
  findings: ReviewerFinding[];
  clean: boolean;
  raw: string;
}

/** A single P0 finding from the janitor agent */
export interface Finding {
  location: string;
  category: FindingCategory;
  evidence: string;
  prescription: string;
}

/** Parsed review result from the janitor agent */
export interface ReviewResult {
  sha: string;
  subject: string;
  date: Date;
  findings: Finding[];
  clean: boolean;
  raw: string;
}

/** Changed file entry from git diff-tree */
export interface ChangedFile {
  status: string;
  path: string;
}

/** Full commit context for building review prompts */
export interface CommitContext {
  sha: string;
  subject: string;
  parents: string[];
  changedFiles: ChangedFile[];
  patch: string;
  patchTruncated: boolean;
}

/** Signal source for commit detection */
export type SignalSource = 'fswatch' | 'tool-hook' | 'poll';

/** A commit detection signal */
export interface CommitSignal {
  source: SignalSource;
  ts: number;
}

/** Review job in the orchestrator queue */
export interface ReviewJob {
  sha: string;
  /** The root session that was active when this commit was detected. */
  parentSessionId?: string;
  /** The child review session spawned for this job. */
  sessionId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  enqueuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: ReviewResult;
  error?: string;
}

/** Sink interface for delivering results */
export interface ResultSink {
  deliver(result: ReviewResult, parentSessionId?: string): Promise<void>;
}
