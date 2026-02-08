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
