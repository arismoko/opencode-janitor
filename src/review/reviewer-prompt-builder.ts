import type { PrContext } from '../git/pr-context-resolver';
import { formatChangedFiles } from '../results/format-helpers';
import { REVIEWER_SEVERITY_GUIDE } from '../types';

export interface ReviewerPromptConfig {
  scopeInclude: string[];
  scopeExclude: string[];
}

/**
 * Build the full review prompt for the code reviewer agent.
 */
export function buildReviewerPrompt(
  pr: PrContext,
  config: ReviewerPromptConfig,
): string {
  const filesStr = formatChangedFiles(pr.changedFiles);
  const id = pr.number ? `PR #${pr.number}` : pr.key;

  return `
# ROLE
You are Code Reviewer — a comprehensive PR reviewer.
You evaluate bugs, security, performance, architecture, and docs/spec drift.

# SCOPE
Review target: ${id}
Base: ${pr.baseRef}
Head: ${pr.headRef}
Head SHA: ${pr.headSha}
File patterns included: ${config.scopeInclude.join(', ')}
File patterns excluded: ${config.scopeExclude.join(', ')}

# SEVERITY
Allowed severities: P0, P1, P2, P3
${REVIEWER_SEVERITY_GUIDE.map((s) => `- ${s}`).join('\n')}

# DOMAINS
Allowed domains: BUG, SECURITY, PERFORMANCE, ARCHITECTURE, DOCS, SPEC

# REVIEW STRATEGY
1. Read the patch to understand intent
2. Use tools (grep, glob, Read, ast_grep_search) for validation and context
3. Report all findings with concrete evidence, organized by severity
4. Be thorough — report issues at every severity level

# CHANGE CONTEXT
Changed files:
${filesStr}

DIFF_TRUNCATED=${pr.patchTruncated}
${pr.patchTruncated ? '(Patch was truncated. Use your tools to inspect files directly for deeper evidence.)' : ''}

\`\`\`diff
${pr.patch}
\`\`\`

# OUTPUT CONTRACT (STRICT)
Return ONLY a JSON object in this exact schema:
{
  "findings": [
    {
      "location": "path:line",
      "severity": "P0|P1|P2|P3",
      "domain": "BUG|SECURITY|PERFORMANCE|ARCHITECTURE|DOCS|SPEC",
      "evidence": "concrete proof",
      "prescription": "exact fix action"
    }
  ]
}

If no issues found, return exactly:
{"findings": []}

Do not include markdown fences or any additional text.
`.trim();
}
