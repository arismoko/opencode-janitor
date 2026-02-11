import { JanitorOutput } from '../../review/finding-schemas';
import { defineAgent } from '../define-agent';
import { buildReviewAgentRuntime } from '../runtime';

const JANITOR_ROLE = `You are The Janitor — the Cleanup Crew / Maintenance Engineer for codebases.

Your goal: keep changes lean, non-redundant, and free of dead weight so the codebase stays easy to evolve.

Your ONLY concerns are structural issues in these domains: YAGNI, DRY, DEAD.

Non-goals (do NOT report these):
- Logic bugs, race conditions, or behavioral correctness issues (handled by Hunter)
- Pure formatting or style-only concerns (handled by linters/formatters)
- Large architectural redesign advice not grounded in changed code

You have access to codebase exploration tools: glob, grep, list, read, lsp.
- Start from the diff to understand what changed and form hypotheses.
- Use lsp or grep to confirm symbol usage/importers before DEAD claims.
- Use read to inspect nearby context when similarity or reachability is uncertain.
- Use glob/list to locate shared utilities/types before proposing DRY extraction.
- Stop once confidence is sufficient; avoid repo-wide deep scans for minor suspicions.

The diff is the entry point, not the boundary. Explore the full repository to validate findings.

Every finding you report MUST be immediately actionable. If it's not worth fixing right now, don't report it.
No finding is preferred over a weak finding.`;

const JANITOR_RULES = `- Evidence must cite 2+ independent signals for structural findings
- If no issues found: output exactly {"findings": []}`;

export const JANITOR_AGENT_DEFINITION = defineAgent<
  'janitor',
  'commit' | 'pr' | 'manual',
  'commit-diff' | 'workspace-diff' | 'repo' | 'pr'
>({
  id: 'janitor',
  label: 'Janitor',
  description:
    'Cleanup Crew / Maintenance Engineer. Keeps changes lean, non-redundant, and free of dead weight.',
  role: JANITOR_ROLE,
  domains: ['YAGNI', 'DRY', 'DEAD'],
  rules: JANITOR_RULES,
  outputSchema: JanitorOutput,
  defaults: {
    autoTriggers: ['commit'],
    manualScope: 'workspace-diff',
    maxFindings: 10,
  },
  capabilities: {
    autoTriggers: ['commit', 'pr'],
    manualScopes: ['workspace-diff', 'repo'],
  },
  cli: {
    command: 'janitor',
    alias: 'j',
    description: 'Run the Janitor agent (structural cleanup: YAGNI, DRY, DEAD)',
  },
  runtime: buildReviewAgentRuntime(),
  resolveManualScope: ({ requestedScope, hasWorkspaceDiff }) => {
    if (requestedScope === 'repo' || requestedScope === 'workspace-diff') {
      return requestedScope;
    }

    return hasWorkspaceDiff ? 'workspace-diff' : 'repo';
  },
  enrichContext: ({ trigger, scope, hasWorkspaceDiff, sha }) => {
    const metadataSuffix: string[] = [];
    if (sha) {
      metadataSuffix.push(`Commit SHA: ${sha}`);
    }

    if (scope === 'repo') {
      return {
        metadataSuffix,
        reason: trigger === 'manual' ? 'manual-repo' : undefined,
      };
    }

    if (scope === 'workspace-diff' && !hasWorkspaceDiff) {
      return { metadataSuffix, reason: 'empty-workspace-fallback' };
    }

    return { metadataSuffix };
  },
});
