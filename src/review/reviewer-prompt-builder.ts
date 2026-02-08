import type { PrContext } from '../git/pr-context-resolver';

export interface ReviewerPromptConfig {
  maxFindings: number;
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
  const filesStr = pr.changedFiles
    .map((f) => `  ${f.status}\t${f.path}`)
    .join('\n');
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
Allowed severities: CRITICAL, HIGH, MEDIUM, LOW
Maximum findings: ${config.maxFindings}

# DOMAINS
Allowed domains: BUG, SECURITY, PERFORMANCE, ARCHITECTURE, DOCS, SPEC

# REVIEW STRATEGY
1. Read the patch to understand intent
2. Use tools (grep, glob, Read, ast_grep_search) for validation and context
3. Report only actionable findings with concrete evidence
4. Prioritize severity and impact

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
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
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
