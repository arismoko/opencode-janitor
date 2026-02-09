### Commit 1: fix(detector): commit processed keys after successful callback

**Files modified:** `src/git/signal-detector.ts`
**Files created:** None  
**Files deleted:** None

Move processed-key persistence in `SignalDetector.verify()` to happen only after `onDetected()` succeeds. Keep `inflight` guard behavior, keep `lastSeenKey` updates aligned with successful processing, and preserve retry semantics for transient callback failures.

### Commit 2: fix(queue): release failed review jobs on session error events

**Files modified:** `src/review/base-orchestrator.ts`, `src/index.ts`
**Files created:** None  
**Files deleted:** None

Add `handleFailure(sessionId, error)` to the base queue class to mark running jobs failed, remove `sessionId -> key` mappings, decrement active count, prune terminal jobs, and continue queue processing. Wire `session.error` handling in `index.ts` to call both queue instances so failed sessions do not block subsequent work.

### Commit 3: fix(parser): fail closed when reviewer output is empty or invalid JSON

**Files modified:** `src/results/reviewer-parser.ts`, `src/review/reviewer-orchestrator.ts`, `src/types.ts`
**Files created:** None  
**Files deleted:** None

Introduce explicit parse statuses (`ok | invalid_output | empty_output`) in reviewer parsing. Return status metadata instead of silently returning `clean: true` on invalid output, and make reviewer orchestration treat non-`ok` parse statuses as job failures with error notification.

### Commit 4: feat(schema): add shared zod finding/output schemas with JSON schema support

**Files modified:** None
**Files created:** `src/schemas/finding.ts`
**Files deleted:** None

Define shared Zod v4 schema primitives for janitor and hunter outputs (domains, severities, base finding, per-agent output objects). Uses Zod v4 native `z.toJSONSchema()` — no `zod-to-json-schema` dependency. This creates the single typed contract used by prompts and parsers.

### Commit 5: refactor(results): unify parsing with AgentOutputCodec and remove duplicate parsers

**Files modified:** `src/results/pipeline.ts`, `src/review/reviewer-orchestrator.ts`, `src/review/orchestrator.ts`
**Files created:** `src/results/agent-output-codec.ts`
**Files deleted:** `src/results/parser.ts`, `src/results/reviewer-parser.ts`

Replace janitor/reviewer parser split with one `parseAgentOutput(raw, schema)` implementation that extracts JSON and validates against zod schemas. Update both orchestrators/pipelines to consume unified parse results and status handling instead of bespoke parser logic.

### Commit 6: refactor(results): unify report rendering with shared renderReport spec

**Files modified:** `src/results/formatter.ts`, `src/results/format-helpers.ts`, `src/review/orchestrator.ts`, `src/review/reviewer-orchestrator.ts`
**Files created:** `src/results/report-renderer.ts`
**Files deleted:** `src/results/reviewer-formatter.ts`

Introduce a shared report renderer that accepts a per-agent view spec (header, finding row, extra sections). Keep janitor-only suppression/history sections and reviewer severity/domain presentation as spec differences rather than separate formatter implementations.

### Commit 7: refactor(sinks): consolidate session/toast/file sinks into parameterized transports

**Files modified:** `src/results/sinks/session-sink.ts`, `src/results/sinks/toast-sink.ts`, `src/results/sinks/file-sink.ts`, `src/review/orchestrator.ts`, `src/review/reviewer-orchestrator.ts`
**Files created:** None
**Files deleted:** `src/results/sinks/reviewer-session-sink.ts`, `src/results/sinks/reviewer-toast-sink.ts`, `src/results/sinks/reviewer-file-sink.ts`

Unify each sink pair into one implementation with parameters for prefix text, summary label, enrichment, report directory, and report id. Remove duplicated filesystem guard/symlink logic and duplicated session/toast injection paths.

### Commit 8: refactor(review): unify agent definition creation behind a factory

**Files modified:** `src/review/janitor-agent.ts`, `src/review/reviewer-agent.ts`, `src/index.ts`
**Files created:** `src/review/agent-factory.ts`, `src/review/agent-profiles.ts`
**Files deleted:** None

Create `createAgentDefinition(profile, config)` with shared permission defaults and model resolution. Convert janitor/reviewer agent modules to profile-driven wrappers so role text/domains/output contract are data-driven instead of duplicated construction code.

### Commit 9: refactor(review): replace split runner functions with single spawnReview

**Files modified:** `src/review/runner.ts`, `src/index.ts`, `src/review/orchestrator.ts`, `src/review/reviewer-orchestrator.ts`
**Files created:** None
**Files deleted:** None

Collapse `spawnJanitorReview` and `spawnReviewerReview` into one `spawnReview(agent, context, config)` API with per-agent metadata (title prefix, agent name, model key). Keep async session creation/prompt behavior identical while removing duplicated runner code.

### Commit 10: refactor(queue): replace orchestrator subclasses with ReviewRunQueue strategies

**Files modified:** `src/index.ts`, `src/review/base-orchestrator.ts`
**Files created:** `src/review/review-run-queue.ts`, `src/review/strategies/janitor-strategy.ts`, `src/review/strategies/reviewer-strategy.ts`
**Files deleted:** `src/review/orchestrator.ts`, `src/review/reviewer-orchestrator.ts`

Rename `BaseOrchestrator` to `ReviewRunQueue` and move agent-specific behavior into strategy objects (`buildResult`, `deliver`, `afterSuccess`). Preserve queue lifecycle (`enqueue`, `handleCompletion`, `handleFailure`, cancellation) and keep failure-release semantics intact so session errors cannot block the queue.

### Commit 11: refactor(prompt): unify prompt builders with profile-driven JSON schema injection (Zod v4 native)

**Files modified:** `src/review/prompt-builder.ts`, `src/review/agent-profiles.ts`, `src/review/agent-factory.ts`, `src/index.ts`
**Files created:** None
**Files deleted:** `src/review/reviewer-prompt-builder.ts`

Implement one prompt builder that composes shared structure plus agent profile (`role`, `domains`, `severityPolicy`, `systemPrompt`) and injects output schema JSON using Zod v4 `z.toJSONSchema()` (no `zod-to-json-schema`). Remove conflicting legacy output contracts (e.g. `NO_P0_FINDINGS`, extra reviewer domains `PERFORMANCE|ARCHITECTURE|DOCS|SPEC`) so both agents emit strict schema-aligned JSON.

### Commit 12: refactor(config)!: rename reviewer to hunter and normalize per-agent config

**Files modified:** `src/config/schema.ts`, `src/config/loader.ts`, `src/index.ts`, `src/types.ts`, `src/review/agent-profiles.ts`, `README.md`
**Files created:** `src/review/hunter-agent.ts`, `src/review/strategies/hunter-strategy.ts`
**Files deleted:** `src/review/reviewer-agent.ts`, `src/review/strategies/reviewer-strategy.ts`

Perform the clean-break identity/config rename: `agents.reviewer` -> `agents.hunter`, `code-reviewer` -> `bug-hunter`, and normalized per-agent delivery settings (`agents.<name>.delivery.*`) with no legacy mapping. Remove backward-compat loader shims; configs using old reviewer keys now fail schema validation.

### Commit 13: refactor(state): rename CommitStore and centralize review key parsing

**Files modified:** `src/state/store.ts`, `src/utils/review-key.ts`, `src/index.ts`, `src/git/pr-context-resolver.ts`, `src/review/strategies/hunter-strategy.ts`, `src/review/strategies/janitor-strategy.ts`
**Files created:** None
**Files deleted:** None

Rename `CommitStore` to `RuntimeStateStore`. Expand existing `src/utils/review-key.ts` (currently only has `extractWorkspaceHeadFromKey`) into canonical typed parse/serialize helpers for all key variants (commit/pr/branch/workspace). Migrate inline `extractHunterHeadFromKey` from `index.ts`, raw key construction from `pr-context-resolver.ts`, and key-derived ID usage in strategy files into the centralized module.

### Commit 14: refactor(runtime): split index.ts into bootstrap/runtime/hooks modules

**Files modified:** `src/index.ts`
**Files created:** `src/runtime/context.ts`, `src/runtime/review-runtime.ts`, `src/hooks/command-hook.ts`, `src/hooks/tool-hook.ts`, `src/hooks/event-hook.ts`, `src/agents/registry.ts`
**Files deleted:** None

Extract initialization, runtime lifecycle, command routing, tool-hook acceleration, event handling, and agent registration into dedicated modules. Extract a shared `RuntimeContext` type (`src/runtime/context.ts`) so hooks are not loosely coupled closures. Ensure `session.error` always forwards to queue failure handlers independent of `trackedSessions.has()` gating — a failed session must release its queue slot even if metadata tracking diverges. Reduce `index.ts` to thin plugin wiring (~945 lines → <100).

### Commit 15: fix(lineage)!: require explicit parent session lineage and remove root-session inference

**Files modified:** `src/review/runner.ts`, `src/review/review-run-queue.ts`, `src/runtime/review-runtime.ts`, `src/hooks/command-hook.ts`
**Files created:** None
**Files deleted:** None

Plumb explicit parent session lineage from enqueue to `session.create` by passing `parentID` through the queue executor and runner. Remove implicit root-session lookup and fallback assignment (`resolveLatestRootSessionId`) so delivery/session ownership is never inferred from titles. Manual `/janitor clean` and `/janitor review` enqueue paths use the invoking session as parent; auto-detected runs intentionally have no parent.

### Commit 16: refactor(types): adopt SDK Hooks/Config/Session types and remove unsafe casts

**Files modified:** `src/index.ts`, `src/agents/registry.ts`, `src/hooks/event-hook.ts`, `src/hooks/command-hook.ts`, `src/hooks/tool-hook.ts`, `src/review/runner.ts`, `src/review/review-run-queue.ts`, `src/results/sinks/toast-sink.ts`
**Files created:** None
**Files deleted:** None

Replace local plugin return/hook shims with `Hooks`/`Config` types from `@opencode-ai/plugin`, and use SDK-generated session/message/part/session-list types for client calls. Remove unsafe casts (`body as any`, `ctx.client as any`, manual message/session array assertions) by aligning call bodies and response handling to SDK contracts directly.

### Commit 17: refactor(runtime): split review-runtime into composition root + runtime modules

**Files modified:** `src/runtime/review-runtime.ts`, `src/runtime/context.ts`, `src/index.ts`
**Files created:** `src/runtime/bootstrap.ts`, `src/runtime/agent-runtime.ts`, `src/runtime/detector-runtime.ts`
**Files deleted:** None

Decompose `review-runtime.ts` into focused modules: bootstrap/service construction, agent queue lifecycle wiring, and detector wiring/startup. Keep `review-runtime.ts` as a thin composition entrypoint used by `index.ts`, preserving behavior while making runtime responsibilities easier to reason about and test.

### Commit 18: refactor(runtime): introduce lightweight agent runtime specs and strategy-owned run preparation

**Files modified:** `src/review/strategies/janitor-strategy.ts`, `src/review/strategies/hunter-strategy.ts`, `src/review/review-run-queue.ts`, `src/runtime/review-runtime.ts`
**Files created:** `src/runtime/agent-runtime-spec.ts`
**Files deleted:** None

Replace duplicated per-agent runtime wiring with a small, internal runtime spec that centralizes trigger mode, queue tag, and executor wiring without introducing a heavy registry framework. Move agent-specific run preparation (context/prompt/session spawn inputs) out of inline closures into strategy/runtime-owned preparation paths. Keep delivery sinks where they are (no separate delivery pipeline abstraction).

### Commit 19: chore(cleanup)!: remove dead legacy paths and harden retry/mutability behavior

**Files modified:** `src/types.ts`, `src/config/schema.ts`, `src/history/store.ts`, `src/git/signal-detector.ts`, `src/utils/logger.ts`, `src/results/agent-output-codec.ts`, `src/hooks/command-hook.ts`, `adr-dual-review-architecture.md`
**Files created:** None
**Files deleted:** `src/utils/async.ts`

Remove dead legacy surface area and stale aliases (`ReviewerSeverity`, `REVIEWER_SEVERITY_GUIDE`, old queue/sink leftovers, unused `autoReview.onCommit`, unused logger debug constant, unused async utility). Remove legacy `category -> domain` normalization from output codec to enforce schema as source of truth. Return defensive copies from history getters, fix `SignalDetector` so `lastSeenKey` advances only after successful callback to preserve retries, and replace command-hook if/else dispatch with a subcommand handler map. Update ADR terminology/contracts to match hunter architecture.
