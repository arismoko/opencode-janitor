How to Add Enriched Findings to an Agent
This guide walks through adding a new finding enrichment to any agent. An enrichment attaches structured, renderable metadata to findings — displayed as expandable sections in the dashboard.
Architecture Overview
Agent definition (shared) Sync script (build-time) Dashboard (cli/frontend)
───────────────────────── ──────────────────────── ─────────────────────────

1. findingEnrichments.definitions 3. copies source renderer → 5. registry.js resolves
   declares kind, title, renderer into frontend asset tree renderer key → module path
   → dynamic import()
2. findingEnrichments.buildSections  
    extracts enrichment data from 4. renderer .js file exports 6. section-shell.js calls
   raw finding → sections[] renderFindingEnrichment() renderer, renders into
   collapsible section
   The 5 pieces you need to create/modify

   | #   | File                                                                  | Purpose                                     |
   | --- | --------------------------------------------------------------------- | ------------------------------------------- |
   | 1   | packages/shared/src/agents/<agent>/definition.ts                      | Declare the enrichment + extraction logic   |
   | 2   | packages/shared/src/agents/<agent>/renderers/<name>-v<N>.js           | Dashboard renderer (vanilla JS)             |
   | 3   | (automatic) sync script copies it to CLI frontend tree on build/test  |                                             |
   | 4   | (automatic) registry.js resolves <agent>.<name>.v<N> → dynamic import |                                             |
   | 5   | Agent's prompt hints (in definition)                                  | Tell the LLM to produce the enrichment data |

   Step-by-step
   Step 1: Define the enrichment in the agent definition
   In packages/shared/src/agents/<agent>/definition.ts, add a findingEnrichments block:
   findingEnrichments: {
   definitions: [
   {
   kind: 'my-analysis', // unique per agent
   title: 'My Analysis', // display title in dashboard
   renderer: '<agent>.my-analysis.v1', // registry key
   collapsedByDefault: true, // start collapsed in UI
   },
   ],
   buildSections: (finding) => {
   // Extract the enrichment payload from the raw finding object.
   // The agent's LLM output should include this data.
   const data = finding.myAnalysis;
   if (!data || typeof data !== 'object') {
   return []; // no enrichment for this finding
   }
   return [
   {
   kind: 'my-analysis', // must match definition.kind
   version: 1, // must match renderer version
   payload: data as Record<string, unknown>,
   },
   ];
   },
   },
   Types involved (from packages/shared/src/agents/core/types.ts):

- FindingEnrichmentDefinition — { kind, title, renderer, collapsedByDefault }
- FindingEnrichmentSection — { kind, version, payload, collapsed? }
  Step 2: Create the renderer source file
  Create packages/shared/src/agents/<agent>/renderers/<name>-v<N>.js
  Filename rules (enforced by sync script):
- Lowercase alphanumeric + hyphens only
- Must end with -v<N>.js (e.g., my-analysis-v1.js)
- Pattern: /^[a-z0-9]+(?:-[a-z0-9]+)\*-v[0-9]+\.js$/
  Renderer contract — must export renderFindingEnrichment:
  export function renderFindingEnrichment({ html, payload, section, definition, finding }) {
  // `html` — tagged template literal (htm/preact)
  // `payload` — the Record<string, unknown> from buildSections
  // `section` — full section object { kind, version, payload }
  // `definition` — { kind, title, renderer, collapsedByDefault }
  // `finding` — the full finding object
  return {
  summaryChips: html`<span class="architecture-chip">some label</span>
 `,
  body: html`<div>Detailed enrichment content here</div>
 `,
  };
  }
  Return shape: { summaryChips, body } — both are htm template results.
- summaryChips — shown inline on the collapsed header
- body — shown when expanded
  Step 3: Add prompt hints (optional but recommended)
  In the agent definition's reviewPromptHints, add instructions telling the LLM to produce the enrichment data in the expected shape:
  reviewPromptHints: () => [
  // ... existing hints
  'Every finding must include myAnalysis: { field1, field2, ... }.',
  ],
  Step 4: Verify

# Sync runs automatically, but you can check manually

bun run --filter @opencode-janitor/cli sync:agent-renderers

# Run tests (includes sync + boundary check)

bun test packages/

# Typecheck

bun run --filter @opencode-janitor/cli typecheck

# Build

bun run build
How the registry resolves renderers
The renderer key format is <namespace>.<name>.v<N>:
inspector.architecture.v1
^^^^^^^^ ^^^^^^^^^^^^ ^^
namespace name version
registry.js parses this into a module path:

- generic namespace → ../renderers/generic/<name>-v<N>.js
- Any other namespace → ../renderers/agents/<namespace>/<name>-v<N>.js
  If the module fails to load, the fallback renderer is used (shows "No renderer registered").
  Dev workflow
  With JANITOR_DEV=1 bun run dev (or just bun run dev since package.json sets it):

1. Edit renderer source in packages/shared/src/agents/<agent>/renderers/
2. Dev watcher detects the change, runs sync, invalidates caches
3. Browser auto-refreshes via SSE live reload
4. See changes immediately
   Reference: existing enrichment (Inspector → Architecture)

   | Piece           | Location                                                                        |
   | --------------- | ------------------------------------------------------------------------------- |
   | Definition      | packages/shared/src/agents/inspector/definition.ts:104-126                      |
   | Renderer source | packages/shared/src/agents/inspector/renderers/architecture-v1.js               |
   | Synced target   | packages/cli/.../renderers/agents/inspector/architecture-v1.js (auto-generated) |
   | Registry key    | inspector.architecture.v1                                                       |
