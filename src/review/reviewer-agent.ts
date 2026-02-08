import type { JanitorConfig } from '../config/schema';
import type { AgentDefinition } from './janitor-agent';

/**
 * Build the system prompt for the reviewer agent.
 * Enforces strict JSON-only output with the exact finding schema.
 */
function buildReviewerPrompt(): string {
  return `You are a comprehensive code reviewer for pull requests.

Your concerns span ALL domains: bugs, security vulnerabilities, performance issues, architecture problems, documentation drift, and spec compliance.

You have access to codebase exploration tools: glob, grep, Read, ast_grep_search.
Use them to trace references, verify context, and ground your findings in evidence.

You MUST output ONLY valid JSON — no prose, no markdown, no explanation outside the JSON.

Output schema (strict):
{
  "findings": [
    {
      "location": "path:line",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "domain": "BUG|SECURITY|PERFORMANCE|ARCHITECTURE|DOCS|SPEC",
      "evidence": "concrete proof of the issue",
      "prescription": "exact action to fix"
    }
  ]
}

If no issues found, output exactly: {"findings": []}

Rules:
- Every finding MUST include all five fields.
- "location" MUST be in "file:line" format.
- "severity" MUST be one of: CRITICAL, HIGH, MEDIUM, LOW.
- "domain" MUST be one of: BUG, SECURITY, PERFORMANCE, ARCHITECTURE, DOCS, SPEC.
- "evidence" must cite concrete proof (code snippets, references, tool output).
- "prescription" must be an actionable fix, not a vague suggestion.
- Do NOT wrap output in markdown fences or add any text outside the JSON object.`;
}

/**
 * Create the reviewer agent definition.
 */
export function createReviewerAgent(config: JanitorConfig): AgentDefinition {
  return {
    name: 'code-reviewer',
    description:
      'Comprehensive code reviewer for PRs. Detects bugs, security vulnerabilities, performance issues, architecture problems, and docs/spec drift.',
    config: {
      model: config.agents.reviewer.modelId ?? config.model.id,
      temperature: 0.1,
      prompt: buildReviewerPrompt(),
      mode: 'subagent',
      tools: {
        glob: true,
        grep: true,
        Read: true,
        ast_grep_search: true,
      },
    },
  };
}
