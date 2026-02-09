import type { PromptConfig, ReviewContext } from '../types/review';
import { formatChangedFiles } from '../utils/format-helpers';

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
  const sections: string[] = [`# SCOPE`, `Review target: ${context.label}`];

  if (context.metadata?.length) {
    sections.push(...context.metadata);
  }

  sections.push(
    `File patterns included: ${config.scopeInclude.join(', ')}`,
    `File patterns excluded: ${config.scopeExclude.join(', ')}`,
    `Maximum findings: ${config.maxFindings}`,
  );

  const hasDiff = context.changedFiles?.length || context.patch?.trim();

  if (hasDiff) {
    const filesStr = formatChangedFiles(context.changedFiles ?? []);
    sections.push(
      '',
      `# REVIEW CONTEXT`,
      `Changed files:`,
      filesStr,
      '',
      `DIFF_TRUNCATED=${context.patchTruncated ?? false}`,
    );

    if (context.patchTruncated) {
      sections.push(
        '(Patch was truncated. Use your tools to inspect files directly for deeper evidence.)',
      );
    }

    sections.push('', '```diff', context.patch ?? '', '```');
  } else {
    sections.push(
      '',
      '# REVIEW CONTEXT',
      'No diff provided — this is a repo-wide analysis run.',
      'Use your tools (glob, grep, read, lsp) to explore the codebase and identify issues.',
    );
  }

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
