/**
 * Review context and git-related types.
 */

// ---------------------------------------------------------------------------
// Changed file
// ---------------------------------------------------------------------------

/** Changed file entry from git diff-tree */
export interface ChangedFile {
  status: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Commit context
// ---------------------------------------------------------------------------

/** Full commit context for building review prompts */
export interface CommitContext {
  sha: string;
  subject: string;
  parents: string[];
  changedFiles: ChangedFile[];
  patch: string;
  patchTruncated: boolean;
  deletionOnly: boolean;
}

// ---------------------------------------------------------------------------
// Review context (for prompt builder)
// ---------------------------------------------------------------------------

interface ReviewContextBase {
  /** Display label (e.g. SHA, PR key) */
  label: string;
  /** Additional metadata lines injected into the CONTEXT section */
  metadata?: string[];
  /** Trigger identifier that produced this review run */
  trigger?: string;
  /** Scope identifier resolved for this review run */
  scope?: string;
  /** Trigger subject key or human-readable equivalent */
  subject?: string;
  /** Scope-specific metadata lines shown near the SCOPE section */
  scopeMetadata?: string[];
}

/** Diff-backed review context (commit/PR/workspace with local changes). */
export interface DiffReviewContext extends ReviewContextBase {
  mode: 'diff';
  changedFiles: ChangedFile[];
  patch: string;
  patchTruncated: boolean;
}

/** Repo-wide review context (no explicit diff payload). */
export interface RepoReviewContext extends ReviewContextBase {
  mode: 'repo';
  reason?: 'manual-repo' | 'empty-workspace-fallback';
}

/** Review context passed to the prompt builder. */
export type ReviewContext = DiffReviewContext | RepoReviewContext;

// ---------------------------------------------------------------------------
// Prompt config
// ---------------------------------------------------------------------------

export interface PromptConfig {
  scopeInclude: string[];
  scopeExclude: string[];
  /** Maximum findings the agent should report */
  maxFindings: number;
  /** Pre-rendered suppressions block (janitor only) */
  suppressionsBlock?: string;
  /** Optional extra hints appended to review prompt */
  promptHints?: string[];
}
