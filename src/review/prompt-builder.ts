import { formatChangedFiles } from '../results/format-helpers';
import type { ChangedFile } from '../types';

// ---------------------------------------------------------------------------
// Review context — union of commit and PR context shapes
// ---------------------------------------------------------------------------

/** Shared fields for any review context passed to the prompt builder. */
export interface ReviewContext {
  /** Display label (e.g. SHA, PR key) */
  label: string;
  /** Changed files in this review */
  changedFiles: ChangedFile[];
  /** Unified diff patch */
  patch: string;
  /** Whether the patch was truncated */
  patchTruncated: boolean;
  /** Additional metadata lines injected into the CONTEXT section */
  metadata?: string[];
}

export interface PromptConfig {
  scopeInclude: string[];
  scopeExclude: string[];
  /** Maximum findings the agent should report */
  maxFindings: number;
  /** Pre-rendered suppressions block (janitor only) */
  suppressionsBlock?: string;
}

/**
 * Build the per-review user prompt for any agent.
 *
 * Agent identity, domains, and output schema are in the system prompt
 * (injected by the agent factory). This prompt provides:
 *   1. Scope filters
 *   2. Review context (metadata, changed files, diff)
 *   3. Suppressions (if any)
 *   4. Output format reminder
 */
export function buildReviewPrompt(
  context: ReviewContext,
  config: PromptConfig,
): string {
  const filesStr = formatChangedFiles(context.changedFiles);

  const sections: string[] = [`# SCOPE`, `Review target: ${context.label}`];

  if (context.metadata?.length) {
    sections.push(...context.metadata);
  }

  sections.push(
    `File patterns included: ${config.scopeInclude.join(', ')}`,
    `File patterns excluded: ${config.scopeExclude.join(', ')}`,
    `Maximum findings: ${config.maxFindings}`,
    '',
    `# REVIEW CONTEXT`,
    `Changed files:`,
    filesStr,
    '',
    `DIFF_TRUNCATED=${context.patchTruncated}`,
  );

  if (context.patchTruncated) {
    sections.push(
      '(Patch was truncated. Use your tools to inspect files directly for deeper evidence.)',
    );
  }

  sections.push('', '```diff', context.patch, '```');

  if (config.suppressionsBlock) {
    sections.push(
      '',
      '# PREVIOUSLY REVIEWED (may be stale — verify before skipping)',
      config.suppressionsBlock,
    );
  }

  sections.push(
    '',
    '# OUTPUT',
    'Return ONLY valid JSON matching the output schema from your instructions.',
    'If no issues found, return exactly: {"findings": []}',
  );

  return sections.join('\n').trim();
}
