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

/** Shared fields for any review context passed to the prompt builder. */
export interface ReviewContext {
  /** Display label (e.g. SHA, PR key) */
  label: string;
  /** Changed files in this review (omit for repo-wide manual runs) */
  changedFiles?: ChangedFile[];
  /** Unified diff patch (omit for repo-wide manual runs) */
  patch?: string;
  /** Whether the patch was truncated */
  patchTruncated?: boolean;
  /** Additional metadata lines injected into the CONTEXT section */
  metadata?: string[];
}

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
}
