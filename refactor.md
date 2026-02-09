# Architectural Audit & Refactor Plan

## Executive Summary

The codebase has one dominant structural problem: **the janitor/reviewer dual-path is implemented as copy-paste parallelism** — separate files for parser, formatter, sinks, orchestrator, prompt-builder, agent definition, and runner methods, with only minor differences between them. This produces ~12 nearly-identical file pairs that diverge silently.

Three secondary problems compound this:
1. **`index.ts` is a god-module** (~500 lines of bootstrap, DI, commands, event handling, detection, and runtime control)
2. **Critical correctness bugs** — parser failures report "clean" (false negative), failed sessions don't release queue slots, signal dedup marks keys before callback succeeds
3. **Naming/config asymmetries** — "orchestrator" is vague, CommitStore is misnamed, config structure differs between agents

---

## Agent Architecture (Revised)

Three agents, shipped in two phases:

### Phase A (this refactor): Janitor + Bug Hunter

| Agent | Identity | Trigger | Lens |
|-------|----------|---------|------|
| **Janitor** | "Is this necessary?" | Commit (automatic) | YAGNI, DRY, simplification |
| **Bug Hunter** | "Is this broken?" | PR (automatic) | Bugs, security, correctness |

### Phase B (post-refactor): Inspector

| Agent | Identity | Trigger | Lens |
|-------|----------|---------|------|
| **Inspector** | "Is this well-structured?" | Manual (`/janitor inspect`), optionally automatic | SOLID, architecture, module boundaries |

The Inspector is deferred because:
1. SOLID analysis requires broad context (full module/system), not just a diff
2. Bug-finding is higher-value and more proven for AI review
3. The unified architecture from this refactor makes adding a third agent trivial

### Janitor — "Is this necessary?"

Code simplicity expert. YAGNI enforcer. Entropy fighter through subtraction.

**Domains:**
- **YAGNI** — premature abstraction, unused extensibility points, "just in case" code, features not required now
- **DRY** — duplicated logic, hardcoded values that duplicate enums, copy-pasted patterns, repeated constants
- **DEAD** — unused exports, unreachable branches, vestigial params, commented-out code

**Cognitive model:**
- Question the necessity of every line
- Challenge every abstraction layer — if it's only used once, inline it
- Replace clever code with obvious code
- Eliminate defensive programming that adds no value
- Simplify complex conditionals; prefer early returns
- Flag premature generalizations and over-engineered solutions

**Does NOT care about:** correctness, bugs, security, performance, architecture, SOLID principles.

### Bug Hunter — "Is this broken?"

Correctness and safety expert. Catches real defects before merge.

**Domains:**
- **BUG** — logic errors, race conditions, off-by-ones, unhandled edge cases, null/undefined hazards
- **SECURITY** — injection, auth bypass, secrets in code, unsafe deserialization, XSS
- **CORRECTNESS** — spec violations, type safety gaps, contract breaches, incorrect error handling

**Does NOT care about:** code hygiene, style, simplicity, architecture, DRY, YAGNI.

### Inspector (Phase B) — "Is this well-structured?"

Architecture reviewer. Runs on demand. Fights structural entropy through reorganization.

**Domains:**
- **SRP** — modules/functions with multiple reasons to change
- **COUPLING** — tight dependencies, missing abstractions at boundaries, dependency direction violations
- **BOUNDARIES** — domain logic mixed with infrastructure, side effects in pure code, missing dependency injection
- **COMPOSITION** — deep inheritance that should be composition, fat interfaces, unnecessary indirection

**Trigger:** Manual via `/inspector` by default. Configurable to run alongside other agents.

**Does NOT care about:** simplicity/YAGNI (that's janitor), bugs/security (that's bug hunter).

### Commands

Each agent owns a top-level slash command:

| Command | Agent | Examples |
|---------|-------|----------|
| `/janitor` | Janitor | `/janitor run`, `/janitor pause`, `/janitor status` |
| `/hunter` | Bug Hunter | `/hunter run`, `/hunter pause`, `/hunter status` |
| `/inspector` | Inspector (Phase B) | `/inspector run`, `/inspector status` |

---

## Severity Scale (shared by all agents)

| Level | Meaning |
|-------|---------|
| P0 | Must fix before merge — broken, vulnerable, or data-loss risk |
| P1 | Should fix soon — clear defect or significant maintenance burden |
| P2 | Fix when convenient — real issue but low blast radius |
| P3 | Consider — minor, worth noting for future awareness |

---

## Critical Bugs (Fix First)

### C1. Parser fail-open returns false "clean"

- **File:** `src/results/reviewer-parser.ts:28-31`
- **What:** When JSON parsing fails, reviewer parser returns `clean: true` — the worst possible failure mode for a correctness reviewer
- **Fix:** Introduce `ParseStatus = 'ok' | 'invalid_output' | 'empty_output'`; treat `invalid_output` as job failure (notify + optional retry), never as clean
- **Effort:** M

### C2. Session error path doesn't release orchestrator job

- **File:** `src/index.ts:847-896`
- **What:** Completion only finalizes through idle handling; error handling updates metadata but never informs queue state. A failed session remains "running" in the orchestrator, blocking the queue
- **Fix:** Add `handleFailure(sessionId, error)` on the base queue manager; call it from `session.error`
- **Effort:** M

### C3. Signal detector commits processed key before callback

- **File:** `src/git/signal-detector.ts:105-113`
- **What:** Keys are marked processed _before_ `onDetected` runs, despite comments claiming post-callback semantics. Transient failures in context build/delivery permanently suppress reprocessing
- **Fix:** Commit processed state _after_ successful callback, or split into `seen` vs `processed` sets with retry policy
- **Effort:** M

---

## Phase 1: Unify the Dual Path

The biggest architectural win. Every pair below has a specific difference; each can be unified with the right abstraction.

### 1.1 Parser → `AgentOutputCodec<T>`

| | Janitor (`parser.ts`) | Reviewer (`reviewer-parser.ts`) |
|---|---|---|
| **Format** | Freeform text, regex-parsed | JSON extraction + manual `isValidFinding()` |
| **Actual difference** | Parse strategy only | Parse strategy only |

**Target:** Both agents emit JSON. Single `parseAgentOutput(raw: string, schema: ZodSchema<T>): ParseResult<T>` with strict parse status. Agent-specific schemas are the only variation.

**Effort:** M

### 1.2 Orchestrator → `ReviewRunQueue<TContext, TResult>`

| | Janitor (`orchestrator.ts`) | Reviewer (`reviewer-orchestrator.ts`) |
|---|---|---|
| **Extra logic** | Suppression/history pipeline (lines 60-69) | GH PR comment posting (lines 116-129) |
| **Queue/lifecycle** | Identical (inherited from BaseOrchestrator) | Identical |

**Target:** One queue engine with pluggable strategy:
```ts
interface ReviewStrategy<TCtx, TResult> {
  buildResult(raw: string, context: TCtx): TResult
  deliver(result: TResult, context: TCtx): Promise<void>
  afterSuccess?(context: TCtx, result: TResult): Promise<void>
}
```

Rename `BaseOrchestrator` → `ReviewRunQueue`. Delete both concrete subclasses; replace with strategy objects.

**Effort:** L

### 1.3 Sinks → Unified Transport + Agent Message Composer

All three sink pairs (session, toast, file) differ only in:
- Message prefix text
- Janitor-only history enrichment section

| Sink | Actual Difference |
|------|-------------------|
| `session-sink.ts` vs `reviewer-session-sink.ts` | Prefix + optional history section |
| `toast-sink.ts` vs `reviewer-toast-sink.ts` | Summary text + optional history enrichment |
| `file-sink.ts` vs `reviewer-file-sink.ts` | Identical path-guard/symlink logic, different filename |

**Target:**
- `deliverSessionMessage({prefix, report, noReply, enrichment?})`
- `deliverToast({summary, enrichment?})`
- `writeReportArtifact({id, dir, report, workspace})`

**Effort:** S per sink (3 × S = M total)

### 1.4 Formatter → `renderReport(result, viewSpec)`

| | Janitor (`formatter.ts`) | Reviewer (`reviewer-formatter.ts`) |
|---|---|---|
| **Includes** | Commit metadata, suppression count | Severity/domain grouping |

**Target:** Shared report DSL with agent-specific view config:
```ts
interface ReportSpec {
  header: (ctx) => string
  findingRenderer: (finding) => string
  sections?: (result) => string[]
}
```

**Effort:** S

### 1.5 Prompt Builder → `buildReviewPrompt(profile, context, schemaJson)`

| | Janitor (`prompt-builder.ts`) | Reviewer (`reviewer-prompt-builder.ts`) |
|---|---|---|
| **Difference** | Role text, domain list, output contract | Role text, domain list, output contract |

**Target:** Common prompt skeleton + agent profile:
```ts
interface AgentProfile {
  role: string
  domains: string[]
  severityPolicy: string
  outputSchema: ZodSchema
  systemPrompt: string  // the full personality/cognitive model text
}
```

**Effort:** M

### 1.6 Agent Definitions → `createAgentDefinition(profile, config)`

| | Janitor (`janitor-agent.ts`) | Reviewer (`reviewer-agent.ts`) |
|---|---|---|
| **Difference** | Name, description, system prompt, model key |

**Target:** Factory function with shared permission defaults.

**Effort:** S

### 1.7 Runner → Single `spawnReview(agent, context, config)`

| | `spawnJanitorReview` | `spawnReviewerReview` |
|---|---|---|
| **Difference** | Label string, agent name, model key |

**Target:** One function, parameterized.

**Effort:** S

---

## Phase 2: Decompose `index.ts`

Current state: ~500 lines mixing bootstrap, DI, command routing, event processing, detection, and runtime control.

### Target module split:

| Module | Responsibility |
|--------|---------------|
| `runtime/bootstrap.ts` | Config loading, repo checks, dependency graph creation |
| `runtime/review-runtime.ts` | Queue lifecycle, detector start/stop, pause/resume |
| `hooks/command-hook.ts` | `/janitor`, `/hunter`, `/inspector` slash command routing |
| `hooks/tool-hook.ts` | Tool-call accelerator logic (PR detection via tool interception) |
| `hooks/event-hook.ts` | Session completion/error/idle handling |
| `agents/registry.ts` | Agent definitions + config-hook registration |

`index.ts` becomes a thin shell: register plugin → call bootstrap → wire hooks.

**Effort:** L

---

## Phase 3: Naming & Config Normalization

### 3.1 Naming Renames

| Current | Target | Reason |
|---------|--------|--------|
| `BaseOrchestrator` | `ReviewRunQueue` | Describes actual behavior (queue + lifecycle) |
| `ReviewOrchestrator` | _(deleted)_ | Replaced by strategy object |
| `ReviewerOrchestrator` | _(deleted)_ | Replaced by strategy object |
| `CommitStore` | `RuntimeStateStore` | Tracks PR keys, reviewer heads, pause flags — not just commits |
| All `reviewer-*` files | `hunter-*` | Reflects new agent identity |
| `code-reviewer` agent name | `bug-hunter` | New agent identity |

### 3.2 Config Normalization

**Current asymmetry:**
- Janitor delivery: flat under `delivery.toast`, `delivery.sessionMessage`, `delivery.reportFile`
- Reviewer delivery: nested under `delivery.reviewer.toast`, `delivery.reviewer.sessionMessage`, `delivery.reviewer.reportFile`

**Target shape:**
```yaml
agents:
  janitor:
    enabled: true
    trigger: commit
    modelId: ...
    delivery:
      toast: true
      sessionMessage: true
      reportFile: true
    memory:
      suppressions: true
      history: true
  hunter:
    enabled: true
    trigger: pr
    modelId: ...
    delivery:
      toast: true
      sessionMessage: true
      reportFile: true
    memory:
      suppressions: false
      history: false
  # Phase B — added post-refactor:
  # inspector:
  #   enabled: false  # opt-in
  #   trigger: manual  # /janitor inspect
  #   modelId: ...
```

**No backwards compatibility.** `agents.reviewer` is deleted, not mapped. Users update their config or it breaks.

**Effort:** M

---

## Phase 4: Asymmetry Resolution

### 4.1 Suppression System

- Currently janitor-only
- **Recommendation:** Add hunter suppression as separate namespace, default limited to P2/P3 only. Never auto-suppress P0/P1 security/correctness findings
- **Effort:** L (deferred — do after unification)

### 4.2 History/Trends

- Currently janitor-only
- **Recommendation:** Add hunter history as separate namespace. Trends are useful for tracking recurring bug patterns
- **Effort:** L (deferred — do after unification)

---

## Phase 5: Cleanup

### 5.1 Dead Code

| Item | Location | Status |
|------|----------|--------|
| `ReviewJob` type | `src/types.ts:105` | Unused — delete |
| `ResultSink` interface | `src/types.ts:120` | Unused — delete |
| `withTimeout` | `src/utils/async.ts:9` | Unused — delete |
| `DEBUG` constant | `src/utils/logger.ts:25` | Unused — delete |

**Effort:** S

### 5.2 State Management Fixes

- **Mutable internals exposed:** `HistoryStore.getReviews()` and `.getLedger()` return internal references (`src/history/store.ts:28-34`). Return readonly copies
- **Session-parent inference is heuristic:** `resolveLatestRootSessionId` scans titles (`src/review/base-orchestrator.ts:65-73`); runner doesn't set `parentID`. Pass `parentID` at session creation and remove title-based inference
- **Effort:** M

### 5.3 Type Safety

- Local hook return interface and `any` casts (`src/index.ts:48`, `src/review/runner.ts:108`) despite typed plugin/SDK defs
- **Fix:** Adopt `Hooks` from plugin package and typed request bodies
- **Effort:** S

### 5.4 Error Handling

- Many `catch {}` paths silently swallow errors
- **Fix:** Classify as expected/terminal/transient; surface structured errors for transient failures
- **Effort:** M

### 5.5 Key Parsing Fragmentation

- Duplicated ad hoc key parsers (`src/index.ts:84`, `src/utils/review-key.ts:7`)
- **Fix:** Centralize in `review-key.ts` with typed key parser/serializer
- **Effort:** S

### 5.6 Stale Docs

- ADR still references old severity enum (`adr-dual-review-architecture.md:46-47`)
- **Fix:** Update or delete stale architecture docs
- **Effort:** S

---

## Zod-Driven Output Schemas

### Shared finding schema

```ts
// src/schemas/finding.ts
import { z } from 'zod';

const JanitorDomainSchema = z.enum(['YAGNI', 'DRY', 'DEAD']);
const HunterDomainSchema = z.enum(['BUG', 'SECURITY', 'CORRECTNESS']);
// Phase B:
// const InspectorDomainSchema = z.enum(['SRP', 'COUPLING', 'BOUNDARIES', 'COMPOSITION']);

const SeveritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);

const BaseFindingSchema = z.object({
  location: z.string().describe('file:line'),
  severity: SeveritySchema,
  evidence: z.string().describe('Concrete proof of the issue'),
  prescription: z.string().describe('Exact action to fix'),
});

export const JanitorFindingSchema = BaseFindingSchema.extend({
  domain: JanitorDomainSchema,
});

export const HunterFindingSchema = BaseFindingSchema.extend({
  domain: HunterDomainSchema,
});

export const JanitorOutputSchema = z.object({
  findings: z.array(JanitorFindingSchema),
});

export const HunterOutputSchema = z.object({
  findings: z.array(HunterFindingSchema),
});
```

### Prompt injection

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';
const schemaJson = JSON.stringify(zodToJsonSchema(JanitorOutputSchema), null, 2);
// Injected into system prompt
```

### Output parsing

```ts
const parsed = JanitorOutputSchema.safeParse(extractedJson);
if (!parsed.success) {
  // Fail closed — never report "clean" on parse failure
}
```

---

## Execution Order

1. **Critical bugs** (C1–C3) — fix immediately, independent of refactor
2. **Zod schemas + unified parser** (Phase 1.1) — foundation for everything else
3. **Unify sinks, formatter, agent defs, runner** (Phase 1.3–1.7) — quick wins, high dedup
4. **Unify orchestrator with strategy pattern** (Phase 1.2) — biggest structural change
5. **Unify prompt builder** (Phase 1.5)
6. **Decompose index.ts** (Phase 2) — do after unification reduces its surface area
7. **Naming + config normalization** (Phase 3) — do alongside or after structural changes
8. **Dead code cleanup** (Phase 5.1) — anytime
9. **State management, type safety, error handling** (Phase 5.2–5.4)
10. **Asymmetry resolution** (Phase 4) — deferred, post-unification
11. **Inspector agent** (Phase B) — add third agent on clean foundation

---

## Checklist

### Critical Bugs
- [ ] Fix C1: parser fail-closed behavior
- [ ] Fix C2: session error releases queue slot
- [ ] Fix C3: signal detector dedup timing

### Unification
- [ ] Add `zod-to-json-schema` dependency
- [ ] Create `src/schemas/finding.ts` with shared Zod schemas
- [ ] Unify parsers → `parseAgentOutput(raw, schema)`
- [ ] Unify sinks (session, toast, file) → parameterized functions
- [ ] Unify formatter → `renderReport(result, viewSpec)`
- [ ] Unify agent definitions → `createAgentDefinition(profile, config)`
- [ ] Unify runner → single `spawnReview(agent, context, config)`
- [ ] Unify orchestrator → `ReviewRunQueue` + strategy pattern
- [ ] Unify prompt builder → `buildReviewPrompt(profile, context, schemaJson)`

### Rename & Config
- [ ] Rename all reviewer files → hunter
- [ ] Rename config key `agents.reviewer` → `agents.hunter` (no legacy compat — old key is an error)
- [ ] Normalize delivery config to per-agent structure
- [ ] Rename `CommitStore` → `RuntimeStateStore`
- [ ] Rename `BaseOrchestrator` → `ReviewRunQueue`
- [ ] Update agent prompts: janitor gets YAGNI/DRY/DEAD focus, hunter gets BUG/SECURITY/CORRECTNESS focus

### Decompose
- [ ] Decompose `index.ts` into runtime/, hooks/, agents/ modules

### Cleanup
- [ ] Delete dead code (`ReviewJob`, `ResultSink`, `withTimeout`, `DEBUG`)
- [ ] Fix mutable state exposure in HistoryStore
- [ ] Fix session-parent inference (use parentID, not title scanning)
- [ ] Adopt typed hooks from plugin SDK
- [ ] Fix error swallowing in catch blocks
- [ ] Centralize key parsing in review-key.ts
- [ ] Update stale ADR docs

### Phase B (post-refactor)
- [ ] Add Inspector agent profile + schema
- [ ] Wire `/inspector` top-level command
- [ ] Add optional automatic trigger config for inspector
- [ ] Build + test
