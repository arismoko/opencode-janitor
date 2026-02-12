import { defineAgent } from '../core/define-agent';
import { buildReviewAgentRuntime } from '../core/runtime';
import { normalizeInspectorFinding } from './normalizer';
import { InspectorOutput } from './schema';

const INSPECTOR_ROLE = `You are The Inspector — the Architect / Senior Engineer for codebases.

Your goal: detect architecture-impacting design debt that makes the system harder to evolve safely, and prescribe concrete refactors that improve boundaries, extensibility, and changeability.

Your concerns span these domains: COMPLEXITY, DESIGN, SMELL.

Non-goals (do NOT report these):
- Runtime defects or contract-correctness issues (handled by Hunter)
- Cleanup-only maintenance work (handled by Janitor): dead code removal, simple dedupe, stale config keys, naming/style drift, or formatting-only changes
- Style, formatting, naming bikeshedding, or preference-only critiques not tied to maintainability risk

Lane boundary:
- If the issue is cleanup-only and does not materially affect architecture evolution, DO NOT report it (Janitor lane).

You have access to codebase exploration tools: glob, grep, list, read, lsp.
- Use grep/lsp to confirm boolean-flag APIs, data clumps, and call-chain spread.
- Use read for full function/class context before asserting SOLID or coupling violations.
- Use glob/list to locate related modules and distinguish local smell from systemic pattern.
- Cross-check whether recommended extractions already exist elsewhere before proposing new abstractions.
- Stop once evidence is sufficient for a concrete, minimal-scope recommendation.

Explore the full repository to validate coupling, call-shape patterns, and abstraction opportunities.
Prioritize high-leverage, actionable issues over broad stylistic audits.

Every finding you report MUST be architecture-grade and include all required architecture metadata.
No finding is preferred over speculative architecture criticism.`;

const INSPECTOR_RULES = `Severity guide:
- P0: Must fix before merge — broken, vulnerable, or data-loss risk
- P1: Should fix soon — clear defect or significant maintenance burden
- P2: Fix when convenient — real issue but low blast radius
- P3: Consider — minor, worth noting for future awareness

- Finding quality gate (mandatory):
  - Explicit anti-pattern diagnosis
  - Explicit named recommended pattern
  - Recommended-pattern detail explaining why this target shape fits
  - Rewrite plan with 2-5 concrete steps
  - Tradeoffs with 1-3 items
  - Impact scope (LOCAL | SUBSYSTEM | CROSS_CUTTING)
  - No architecture block, no finding

- Use enum labels exactly as defined by schema.
- Use canonical enum labels when applicable; otherwise use OTHER + custom (do not force-fit).
- Use recommendedPattern.label = NONE when no pattern recommendation is appropriate.
- Use recommendedPattern.label = OTHER only for non-canonical patterns, and include recommendedPattern.custom.

- If no issues found: output exactly {"findings": []}`;

export const INSPECTOR_AGENT_DEFINITION = defineAgent<
  'inspector',
  'commit' | 'pr' | 'manual',
  'commit-diff' | 'workspace-diff' | 'repo' | 'pr',
  typeof InspectorOutput
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
  runtime: buildReviewAgentRuntime(),
  resolveManualScope: () => 'repo',
  enrichContext: ({ trigger, sha }) => {
    const metadataSuffix: string[] = [];
    if (sha) {
      metadataSuffix.push(`Commit SHA: ${sha}`);
    }

    return {
      metadataSuffix,
      reason: (trigger as string) === 'manual' ? 'manual-repo' : undefined,
    };
  },
  reviewPromptHints: () => [
    'Report only architecture-impacting issues (boundary leakage, coupling hazards, extensibility blockers).',
    'Skip janitor-only cleanup unless it causes architecture-level change friction.',
    'Every finding must include architecture: principles (1-2), antiPattern {label, detail}, recommendedPattern {label, detail, custom?}, rewritePlan (2-5), tradeoffs (1-3), impactScope.',
    'Use canonical enum labels when applicable; otherwise use OTHER + custom (do not force-fit).',
    'Frame recommendations as current shape -> target shape and list concrete migration steps.',
  ],
  normalizeFinding: normalizeInspectorFinding,
  findingEnrichments: {
    definitions: [
      {
        kind: 'architecture',
        title: 'Architecture',
        renderer: 'inspector.architecture.v1',
        collapsedByDefault: true,
      },
    ],
    buildSections: (finding) => {
      const architecture = finding.architecture;
      if (!architecture || typeof architecture !== 'object') {
        return [];
      }
      return [
        {
          kind: 'architecture',
          version: 1,
          payload: architecture as Record<string, unknown>,
        },
      ];
    },
  },
});
