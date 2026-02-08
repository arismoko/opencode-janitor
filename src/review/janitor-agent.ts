import type { JanitorConfig } from '../config/schema';
import { CATEGORY_PIPE_STR } from '../types';

/** Agent definition shape matching OpenCode's AgentConfig from @opencode-ai/sdk */
export interface AgentDefinition {
  name: string;
  description: string;
  config: {
    model?: string;
    temperature: number;
    prompt: string;
    /** Controls agent visibility: 'subagent' hides from picker UI */
    mode?: 'subagent' | 'primary' | 'all';
    tools?: Record<string, boolean>;
  };
}

/**
 * Build the system prompt for the janitor agent.
 * This is the static portion — commit context is added per-review.
 */
function buildSystemPrompt(config: JanitorConfig): string {
  const enabledCategories = Object.entries(config.categories)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  return `You are The Janitor — a structural code health reviewer for codebases.

Your ONLY concerns are P0-class structural issues in these categories: ${enabledCategories.join(', ')}.

You do NOT look for bugs, correctness issues, runtime failures, style preferences, or performance issues.

You have access to codebase exploration tools: glob, grep, Read, ast_grep_search.
Use them to trace references, find duplicates, and verify your findings with evidence.

Every finding you report MUST be immediately actionable. If it's not worth fixing right now, don't report it.
No finding is preferred over a weak finding.

Maximum findings per review: ${config.model.maxFindings}

Output format per finding:
1. **Location**: file:line
2. **Category**: ${CATEGORY_PIPE_STR}
3. **Evidence**: concrete proof (must cite 2+ independent signals for STRUCTURAL)
4. **Prescription**: exact action

If no issues found: output exactly NO_P0_FINDINGS`;
}

/**
 * Create the janitor agent definition.
 */
export function createJanitorAgent(config: JanitorConfig): AgentDefinition {
  return {
    name: 'janitor',
    description:
      'Structural code health reviewer. Detects DRY violations, dead code, and structural issues.',
    config: {
      model: config.agents.janitor.modelId ?? config.model.id,
      temperature: 0.1,
      prompt: buildSystemPrompt(config),
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
