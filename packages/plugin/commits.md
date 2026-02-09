## Refactor Commit Log

| # | Title | Summary |
|---|-------|---------|
| 0a | `refactor: run janitor and reviewer in independent root sessions` | Independent root sessions for janitor/reviewer, decoupled lifecycle |
| 0b | `refactor: harden janitor lifecycle and workspace review commands` | Robust lifecycle management and workspace review command surface |
| 0c | `refactor: dedupe workspace review helpers and preserve trigger defaults` | Deduplicate workspace review helpers, preserve trigger defaults |
| 0d | `refactor: rewrite inspect script with status/formatting, dedupe shared utils` | Rewrite inspect script with status display, formatting, dedupe shared utils |
| 0e | `refactor: drop broken status API, use recency indicator instead` | Drop broken status API, replace with recency-based indicator |
| 0f | `chore: add state-dir inspect tooling, trigger mode 'never', and dev deps` | State-dir inspect tooling, `never` trigger mode, dev dependency additions |
| 1 | `fix(detector): commit processed keys after successful callback` | Persist processed keys only after `onDetected` succeeds so transient failures retry safely |
| 2 | `fix(queue): release failed review jobs on session error events` | Explicit failure handling frees queue capacity when sessions error out |
| 3 | `fix(parser): fail closed when reviewer output is empty or invalid JSON` | Treat empty/invalid model output as parse failure instead of silently passing clean |
| 4 | `feat(schema): add shared Zod finding/output schemas with JSON schema support` | Zod v4 schemas as the single contract for findings and output JSON |
| 5 | `refactor(results): unify parsing with AgentOutputCodec and remove duplicate parsers` | One `parseAgentOutput(raw, schema)` replaces janitor/reviewer parser split |
| 6 | `refactor(results): unify report rendering with shared renderReport spec` | Shared report renderer with per-agent view specs replaces separate formatters |
| 7 | `refactor(sinks): consolidate session/toast/file sinks into parameterized transports` | Unified sink implementations with parameters instead of duplicated pairs |
| 8 | `refactor(review): unify agent definition creation behind a factory` | Profile-driven `createAgentDefinition(profile, config)` replaces duplicated construction |
| 9 | `refactor(review): replace split runner functions with single spawnReview` | One `spawnReview` API replaces per-agent spawn functions |
| 10 | `refactor(queue): replace orchestrator subclasses with ReviewRunQueue strategies` | Strategy-based `ReviewRunQueue` replaces `BaseOrchestrator` subclass hierarchy |
| 11 | `refactor(prompts): unify prompt builders and inject machine-generated JSON schema` | One prompt builder with Zod v4 native `toJSONSchema()`, no `zod-to-json-schema` |
| 12 | `refactor(config)!: rename reviewer to hunter and normalize per-agent config` | Clean-break `reviewer` → `hunter` rename, no backwards compat shims |
| 13 | `refactor(state): rename CommitStore to RuntimeStateStore and centralize review key parsing` | Centralized review key parse/serialize helpers, renamed state store |
| 14 | `refactor(runtime): split index.ts into bootstrap/runtime/hooks modules` | Monolithic `index.ts` (~945 lines) → thin wiring (<100 lines) + focused modules |
| 15 | `fix(lineage)!: require explicit parent session lineage and remove root-session inference` | Explicit `parentID` plumbing, no implicit root-session lookup |
| 16 | `refactor(types): adopt SDK Hooks/Config/Session types and remove unsafe casts` | SDK-native types replace local shims and `as any` casts |
| 17 | `refactor(runtime): split review-runtime into composition root + runtime modules` | `review-runtime.ts` decomposed into bootstrap, agent-runtime, detector-runtime |
| 18 | `refactor(runtime): introduce lightweight agent runtime specs and strategy-owned run preparation` | `AgentRuntimeSpec` centralizes trigger mode, queue tag, executor wiring |
| 19 | `chore(cleanup)!: remove dead legacy paths and harden retry/mutability behavior` | Dead code removal, defensive copies, retry hardening |
| 20 | `docs: update README and remove stale ADR to match refactored architecture` | README refresh, outdated ADR removed |
| 21 | `refactor(runtime): introduce AgentRuntimeRegistry for pluggable runtime specs` | Registry for spec registration/lookup, strategies own `createSpec()` |
| 22 | `refactor(runtime): decompose RuntimeContext into focused context slices` | Git/Config/Queue/Session slices with Pick-based hook projection types |
| 23 | `refactor(runtime): rename orchestrator variables to queue` | `orchestrator`/`hunterOrchestrator` → `janitorQueue`/`hunterQueue` across 11 files |
| 24 | `refactor(runtime): add session ownership dispatcher for completion/error routing` | `SessionOwnershipDispatcher` maps sessionID → owning queue for O(1) routing |
| 25 | `refactor(runtime): extract shared runtime primitives to break context slice cycles` | `Exec`/`AgentControl`/`RuntimeFlag` moved to leaf `runtime-types.ts` |
| 26 | `refactor(queue): centralize hunter in-flight head detection` | `hasHeadInFlight()` method replaces duplicated inline functions |
| 27 | `fix(detector): skip review runs for deletion-only commits` | `deletionOnly` flag on `CommitContext`, early-return before queue enqueue |
| 28 | `refactor(commands): split monolithic /janitor command into per-agent commands` | Per-agent slash commands (`/janitor`, `/hunter`, `/inspector`, `/scribe`) with `run\|status\|stop\|resume` dispatch |
| 29 | `refactor(config): add manual trigger mode and per-agent maxFindings` | `manual` trigger enum, per-agent `maxFindings`, widened `AgentProfile.configKey` |
| 30 | `fix(review): align janitor and hunter profiles with spec language` | Spec-aligned role text, non-goals, tool guidance; `bug-hunter` → `hunter` normalization |
| 31 | `feat(schema): add inspector and scribe finding schemas` | `InspectorDomain`/`ScribeDomain` enums + Zod v4 finding/output schemas |
| 32 | `feat(review): add inspector and scribe agent profiles` | `INSPECTOR_PROFILE`/`SCRIBE_PROFILE` with spec role text, registered in plugin entry |
| 33 | `feat(strategy): implement inspector review strategy and runtime spec` | `InspectorStrategy` with manual trigger, repo-wide context, optional diff. `inspectorQueue` wired in agent-runtime/review-runtime |
| 33b | `refactor(review): consolidate agent wrapper files into profile-driven factory` | `AGENT_PROFILES` map + `createAgent()` factory replaces 4 single-line agent wrapper files |
| 34 | `feat(strategy): implement scribe strategy with doc-index input context` | `ScribeStrategy` with doc-index context (`buildDocIndex()`). `scribeQueue` wired in agent-runtime/review-runtime |
| 35 | `feat(commands): wire inspector and scribe into per-agent command surface` | Full `run\|status\|stop\|resume` for inspector/scribe. 4-agent `AgentControl` persistence. `CommandHookContext` updated |
| 35b | `refactor(commands): DRY stop/resume/status handlers and shutdown teardown` | Shared `handleStop()`/`handleResume()`/`renderAgentStatusLine()`/`renderDetailedStatus()` helpers. Array-based queue shutdown |
| 36a | `refactor(runtime)!: replace per-agent trigger booleans with agent trigger matrix plumbing` | `AgentTriggers` matrix replaces 4 per-agent boolean pairs. `BootstrapServices`/`ConfigContext` contract updated. Detector accepts full queue bundle |
| 36b | `feat(runtime)!: auto-enqueue inspector and scribe on configured commit/pr triggers` | Inspector/scribe auto-enqueue on commit/PR signals using `agentTriggers` matrix. Deterministic auto keys (`inspector:auto:commit:<sha>` etc.) |
| 37 | `fix(agents): restore subagent mode to hide review agents from UI picker` | Changed `mode: 'primary'` back to `mode: 'subagent'` so agents don't appear in OpenCode's agent picker UI |
| 38 | `refactor(detector): use parseReviewKey instead of manual string splitting` | Replace `key.startsWith('pr:')` + `key.split(':')` with `parseReviewKey()` discriminated union |
| 39 | `refactor(control): replace per-agent pause booleans with Record<AgentName, boolean>` | `AgentControl.paused: Record<AgentName, boolean>` replaces 4 boolean fields. `AgentName` moved to leaf `runtime-types.ts`. `pauseKey` indirection map eliminated |
| 40 | `refactor(detector): restructure callbacks into phases and fix hunter early-return bug` | Restructure commit/PR callbacks into phases (resolve → guard → per-agent enqueue). Fix bug where hunter dedup `return` silently skipped inspector/scribe |
