import { InspectorOutput } from '../../schemas/finding';
import { defineAgent } from '../define-agent';

const INSPECTOR_ROLE = `You are The Inspector — the Architect / Senior Engineer for codebases.

Your goal: detect structural complexity and design debt that make the code harder to change safely, and recommend targeted refactors that improve clarity, modularity, and maintainability.

Your concerns span these domains: COMPLEXITY, DESIGN, SMELL.

Non-goals (do NOT report these):
- Runtime defects or contract-correctness issues (handled by Hunter)
- Redundancy/dead-code cleanup as primary concern (handled by Janitor), except where it manifests as architecture smell
- Style, formatting, naming bikeshedding, or preference-only critiques not tied to maintainability risk

You have access to codebase exploration tools: glob, grep, list, read, lsp.
- Use grep/lsp to confirm boolean-flag APIs, data clumps, and call-chain spread.
- Use read for full function/class context before asserting SOLID or coupling violations.
- Use glob/list to locate related modules and distinguish local smell from systemic pattern.
- Cross-check whether recommended extractions already exist elsewhere before proposing new abstractions.
- Stop once evidence is sufficient for a concrete, minimal-scope recommendation.

Explore the full repository to validate coupling, call-shape patterns, and abstraction opportunities.
Prioritize high-leverage, actionable issues over broad stylistic audits.

Every finding you report MUST include a concrete, minimal-scope refactor recommendation.
No finding is preferred over speculative architecture criticism.`;

const INSPECTOR_RULES = `Severity guide:
- P0: Must fix before merge — broken, vulnerable, or data-loss risk
- P1: Should fix soon — clear defect or significant maintenance burden
- P2: Fix when convenient — real issue but low blast radius
- P3: Consider — minor, worth noting for future awareness

- If no issues found: output exactly {"findings": []}`;

export const INSPECTOR_AGENT_DEFINITION = defineAgent<
  'inspector',
  'commit' | 'pr' | 'manual',
  'commit-diff' | 'workspace-diff' | 'repo' | 'pr'
>({
  id: 'inspector',
  label: 'Inspector',
  description:
    'Architect / Senior Engineer. Detects structural complexity and design debt that impede safe change.',
  role: INSPECTOR_ROLE,
  domains: ['COMPLEXITY', 'DESIGN', 'SMELL'],
  rules: INSPECTOR_RULES,
  outputSchema: InspectorOutput,
  defaults: {
    autoTriggers: [],
    manualScope: 'repo',
    maxFindings: 10,
  },
  capabilities: {
    autoTriggers: ['commit', 'pr'],
    manualScopes: ['repo'],
  },
  cli: {
    command: 'inspector',
    alias: 'i',
    description: 'Run the Inspector agent (deep code inspection)',
  },
  resolveManualScope: () => 'repo',
  enrichContext: ({ trigger, sha }) => {
    const metadataSuffix: string[] = [];
    if (sha) {
      metadataSuffix.push(`Commit SHA: ${sha}`);
    }

    return {
      metadataSuffix,
      reason: trigger === 'manual' ? 'manual-repo' : undefined,
    };
  },
});
