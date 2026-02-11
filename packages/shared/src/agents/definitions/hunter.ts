import { HunterOutput } from '../../schemas/finding';
import { defineAgent } from '../define-agent';

const HUNTER_ROLE = `You are The Hunter — the Bug Hunter / Adversarial Reviewer for pull requests.

Your goal: detect defects that can cause incorrect behavior or contract violations in changed code.

Your concerns span these domains: BUG, CORRECTNESS.

Non-goals (do NOT report these):
- Redundancy, speculative abstraction, or dead-code cleanup unless directly causing a bug (handled by Janitor)
- Style or formatting concerns (handled by linters/formatters)
- Broad architecture preferences not tied to concrete failure risk

You have access to codebase exploration tools: glob, grep, list, read, lsp.
- Start from diff hunks; build hypotheses for bug/correctness risks.
- Use lsp/grep to trace call chains and symbol usage.
- Use read for full function/module context before claiming contract mismatch.
- Use glob/list to locate API specs, type definitions, and invariant-enforcing modules.
- Keep searches scoped to validating candidate findings, not exploratory scanning without signal.

The diff is the entry point, not the boundary. Explore the full repository to trace call chains and build complete evidence.

Report ALL findings you discover, organized by severity. Be thorough.`;

const HUNTER_RULES = `Severity guide:
- P0: Must fix before merge — broken, vulnerable, or data-loss risk
- P1: Should fix soon — clear defect or significant maintenance burden
- P2: Fix when convenient — real issue but low blast radius
- P3: Consider — minor, worth noting for future awareness`;

function hasManualPrInput(
  manualInput: Record<string, unknown> | undefined,
): boolean {
  return typeof manualInput?.prNumber === 'number';
}

export const HUNTER_AGENT_DEFINITION = defineAgent<
  'hunter',
  'commit' | 'pr' | 'manual',
  'commit-diff' | 'workspace-diff' | 'repo' | 'pr'
>({
  id: 'hunter',
  label: 'Hunter',
  description:
    'Bug Hunter / Adversarial Reviewer. Detects defects and contract violations in changed code.',
  role: HUNTER_ROLE,
  domains: ['BUG', 'CORRECTNESS'],
  rules: HUNTER_RULES,
  outputSchema: HunterOutput,
  defaults: {
    autoTriggers: ['pr'],
    manualScope: 'workspace-diff',
    maxFindings: 10,
  },
  capabilities: {
    autoTriggers: ['commit', 'pr'],
    manualScopes: ['workspace-diff', 'repo', 'pr'],
  },
  cli: {
    command: 'hunter',
    alias: 'h',
    description: 'Run the Hunter agent (bug/correctness defects)',
  },
  resolveManualScope: ({ requestedScope, hasWorkspaceDiff, manualInput }) => {
    if (
      requestedScope === 'workspace-diff' ||
      requestedScope === 'repo' ||
      requestedScope === 'pr'
    ) {
      return requestedScope;
    }

    if (hasManualPrInput(manualInput)) {
      return 'pr';
    }

    return hasWorkspaceDiff ? 'workspace-diff' : 'repo';
  },
  enrichContext: ({ trigger, scope, hasWorkspaceDiff, sha, prNumber }) => {
    const metadataSuffix: string[] = [];
    if (sha) {
      metadataSuffix.push(`Commit SHA: ${sha}`);
    }
    if (prNumber !== undefined) {
      metadataSuffix.push(`PR #${prNumber}`);
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
