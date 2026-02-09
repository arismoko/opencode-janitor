# opencode-janitor Plan

## Overall Goal

Build a clean-break, Bun-native **CLI daemon** that runs multi-agent code reviews (janitor, hunter, inspector, scribe) across multiple repos, with:

- reliable background execution
- async session handling via SSE completion events
- SQLite as source of truth for jobs/runs/findings
- a thin plugin focused on agent registration, commands, and findings access

## Guardrails

- No backwards compatibility, no shims, no legacy paths.
- Shared schemas/types stay in `packages/shared`.
- Daemon/runtime logic stays in `packages/cli`.
- Keep architecture plugin-like: factory + registry + spec + runner boundaries.

## Current Snapshot

Completed:

- Monorepo split (`plugin`, `shared`, `cli`)
- Shared foundations (schemas/types/review helpers)
- CLI config + SQLite schema + migrations
- Daemon lifecycle + IPC skeleton
- Repo detectors + trigger/job ingestion
- Runtime refactor (agent factory, runtime specs, registry)
- Async execution path (`promptAsync` + SSE completion bus + message fetch)
- Daemon-owned `opencode serve` child process management
- P0 hardening complete:
  - Agent execution pipeline extracted from scheduler
  - Runtime specs upgraded to typed hooks (`prepareContext`, `buildPrompt`, `parseOutput`, `onSuccess`)
  - SDK-native agent config typing with validation (no unsafe permission cast)
  - Cancellation-first shutdown with bounded scheduler drain and session cancellation
  - Prompt scope moved to config/spec ownership (`[scope]`)
  - Child readiness parsing hardened with chunk-safe line buffering
- P1 core orchestration complete:
  - Per-agent normalized run outcomes + structured summary persistence
  - Deterministic retry classification (transient vs terminal vs cancelled)
  - Idempotent run/finding persistence across requeues and restarts

Remaining before plugin slim-down:

1. Build daemon event stream API for dashboard consumers (P2.1).
2. Implement Ink dashboard UI (P2.2) with read-only state over event journal/queries (P2.3).
3. Production polish + ops/runtime hardening (P3).

## Refactor Plan (Priority)

### P0 - Phase 5 Architecture Hardening

1. **Extract AgentExecutionPipeline from scheduler** (DONE)
   - Split job orchestration from per-agent execution stages.
   - Stages: context prep -> prompt prep -> async run -> completion wait -> parse -> persist.

2. **Upgrade AgentRuntimeSpec contracts** (DONE)
   - Move from simple trigger gates to typed hooks:
     - `prepareContext(...)`
     - `buildPrompt(...)`
     - `parseOutput(...)`
     - `onSuccess(...)`
   - Support commit/pr/manual cleanly without worker branching.

3. **Remove permission cast** (DONE)
   - Use SDK-native permission types end-to-end.
   - Validate agent config at daemon startup; fail fast on invalid shape.

4. **Cancellation-first shutdown** (DONE)
   - Stop completion bus with explicit cancellation broadcast.
   - Abort active sessions.
   - Drain scheduler with bounded timeout.

5. **Move prompt policy out of worker** (DONE)
   - Scope include/exclude and related prompt limits become config/spec owned.

6. **Harden opencode child readiness** (DONE)
   - Parse stdout with line buffer accumulation (chunk-safe), not per-chunk regex only.

### P1 - Phase 6 Multi-Agent Orchestration Completion

1. Add per-agent execution summary and normalized run outcome model. (DONE)
2. Add deterministic retry policy (transient vs terminal error classification). (DONE)
3. Ensure idempotent run persistence for requeues and daemon restarts. (DONE)

### P2 - Phase 7 Dashboard

1. Add WebSocket/SSE daemon event stream API for UI consumers.
2. Build Ink dashboard (repo status, agent strip, activity log, keybinds).
3. Keep dashboard read-only over event journal + state queries.

### P3 - Phase 8/9 Hardening

1. Production command polish (`start/stop/status/review/log/config`).
2. systemd/launchd guidance.
3. Recovery and chaos tests (stream drop, server crash, daemon restart, stuck session timeout).

## Exit Criteria Before Plugin Slim-Down

- Scheduler/runner architecture is modular and testable.
- Multi-agent async flow is stable under retries/restarts.
- Event stream and dashboard are operational.
- Daemon owns the full runtime lifecycle cleanly.
