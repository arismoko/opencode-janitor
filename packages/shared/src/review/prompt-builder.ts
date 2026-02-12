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

  if (context.trigger) {
    sections.push(`Trigger: ${context.trigger}`);
  }
  if (context.scope) {
    sections.push(`Scope: ${context.scope}`);
  }
  if (context.subject) {
    sections.push(`Subject: ${context.subject}`);
  }
  if (context.scopeMetadata?.length) {
    sections.push(...context.scopeMetadata);
  }

  if (context.metadata?.length) {
    sections.push(...context.metadata);
  }

  sections.push(
    `File patterns included: ${config.scopeInclude.join(', ')}`,
    `File patterns excluded: ${config.scopeExclude.join(', ')}`,
    `Maximum findings: ${config.maxFindings}`,
  );

  if (context.userInstruction || context.focusPath) {
    sections.push('', '# USER CONTEXT');
    if (context.userInstruction) {
      sections.push(`Instruction: ${context.userInstruction}`);
    }
    if (context.focusPath) {
      sections.push(`Focus path: ${context.focusPath}`);
    }
    sections.push(
      'This is additive guidance only. You must still return valid JSON that matches the required output schema.',
    );
  }

  if (context.mode === 'diff') {
    const filesStr = formatChangedFiles(context.changedFiles);
    sections.push(
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
  } else {
    if (context.reason === 'empty-workspace-fallback') {
      sections.push(
        '',
        '# REVIEW CONTEXT',
        'No workspace diff detected — falling back to a repo-wide analysis run.',
        'Use your tools (glob, grep, read, lsp) to explore the codebase and identify issues.',
      );
    } else {
      sections.push(
        '',
        '# REVIEW CONTEXT',
        'No diff provided — this is a repo-wide analysis run.',
        'Use your tools (glob, grep, read, lsp) to explore the codebase and identify issues.',
      );
    }
  }

  if (config.suppressionsBlock) {
    sections.push(
      '',
      '# PREVIOUSLY REVIEWED (may be stale — verify before skipping)',
      config.suppressionsBlock,
    );
  }

  if (config.promptHints?.length) {
    sections.push('', '# REVIEW HINTS', ...config.promptHints);
  }

  sections.push(
    '',
    '# OUTPUT',
    'Return ONLY valid JSON matching the output schema from your instructions.',
    'If no issues found, return exactly: {"findings": []}',
  );

  return sections.join('\n').trim();
}
