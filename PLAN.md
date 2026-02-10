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
- Keep architecture plugin-like: bootstrap + typed context slices + ownership dispatcher + strategy-local specs.
- `packages/shared/src/schemas/finding.ts` remains the source of truth for domain/severity enums.

## Current Snapshot

Completed:

- Monorepo split (`plugin`, `shared`, `cli`) via `0422456`
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
- P0 + P1 landed via `0f54d30`
- P1.5 architecture debt retirement landed via `6a2d200`
- P1.6 detector scalability landed via `f6dca2d`

## Milestone Commits

- `0422456` — workspace split into `plugin` + `shared` + `cli`
- `0f54d30` — CLI daemon runtime foundations + P0/P1 hardening
- `6a2d200` — P1.5 architecture debt retirement (strategy runtime, trigger model, queue/event primitives)
- `f6dca2d` — P1.6 detector scalability (due-time scheduling, async probes, idle backoff, PR TTL)

## Decision Note - Trigger Ingestion (v1)

- v1 remains polling-first and local-runtime-first.
- Webhook ingestion is intentionally deferred to avoid added network/auth/ops complexity.
- P1.6 detector scalability is the approved path for 200-500 mostly idle repos.

Decision owner and cadence:

- Owner: CLI runtime maintainers.
- Cadence: weekly review for first 4 weeks after P1.6 rollout, then monthly.
- Inputs: detector telemetry + queue health + GH API pressure metrics.

Reevaluation gates for webhook adoption:

- Active-repo detection latency remains above SLA after P1.6 tuning
  - Gate: p95 active-repo detection delay > 45s for 7 consecutive days.
- GH CLI/API pressure remains high after PR TTL gating
  - Gate: GH 429 + command error rate > 2% sustained over 24h windows.
- Fleet behavior shifts from mostly idle to mostly hot repos
  - Gate: > 40% repos changed at least once per 15-minute window during peak periods.
- Scale target exceeds current design center and polling no longer has margin
  - Gate: sustained operation > 500 repos with queue-time or detector-SLA breach.

Telemetry to track for decision quality:

- p95/p99 detection delay for active repos.
- Probe volume by kind (commit/pr) and due-lag.
- GH PR call volume and 429/error rates.
- Queue depth and time-to-start under sustained churn.

If webhook adoption is triggered later:

- Minimal scope first: PR synchronization/open/reopen events only.
- Keep polling as anti-entropy fallback during rollout.
- Require signed delivery verification and replay protection before enabling production ingestion.

Remaining before plugin slim-down:

1. Build dashboard UI on top of daemon event cursor/SSE primitives.
2. Complete production hardening and recovery/chaos validation.

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

### P1.5 - Architecture Debt Retirement (Commit-by-Commit)

Execution order below is strict unless noted.

1. **Extract CLI composition root and context slices** (DONE)
   - Add `packages/cli/src/runtime/bootstrap.ts` and `packages/cli/src/runtime/context*.ts`.
   - Narrow runtime surfaces consumed by scheduler/detectors/socket.
   - Goal: match plugin composition-root clarity.

2. **Introduce strategy-local agent specs in CLI** (DONE)
   - Add `packages/cli/src/reviews/strategies/{janitor,hunter,inspector,scribe}-strategy.ts`.
   - Move per-agent behavior out of generic spec factory.
   - Goal: match plugin per-agent encapsulation.

3. **Refactor trigger flow to discriminated trigger context (`commit|pr|manual`)** (DONE)
   - Remove commit-centric assumptions from worker/pipeline/spec inputs.
   - Context resolution becomes strategy-owned.

4. **Fail closed for git/trigger context resolution** (DONE)
   - Treat malformed trigger keys and git command failures as explicit terminal errors.
   - Remove fail-open paths in review context collection.

5. **Add session ownership dispatcher to CLI runtime** (DONE)
   - Introduce owner routing boundary similar to plugin dispatcher model.
   - Reduce implicit coupling between completion bus and pipeline control flow.

6. **Derive DB enum constraints from shared schema/constants** (DONE)
   - Remove hardcoded enum literal drift risk in migration SQL.
   - Add migration to rebuild affected constraints cleanly.

7. **Honor retry knobs end-to-end** (DONE)
   - Persist configured `maxAttempts` at enqueue time.
   - Add retry scheduling (`retryBackoffMs`) and claim only ready jobs.

8. **Daemon-own review enqueue API** (DONE)
   - Add daemon endpoint for manual enqueue and route CLI `review` through IPC.
   - Remove direct DB enqueue from command path.

9. **Replace fixed polling with signal-driven scheduler wakeups** (DONE)
   - Wake scheduler on enqueue/detector events.
   - Keep bounded fallback heartbeat only.

10. **Add event cursor + SSE stream daemon primitives** (DONE)
    - Add `afterSeq`-based event query and stream contracts.
    - This is the data plane for dashboard/log follow.

11. **Add `log --follow` on stream primitives** (DONE)
    - Validate stream contract before dashboard UI work.

Dependencies:
- `1 -> 2 -> 3 -> 4`
- `1 -> 5`
- `6 -> 7`
- `8 -> 9`
- `10 -> 11`

### P1.6 - Detector Scalability Pass (DONE)

Goal: scale trigger detection for mostly idle 200-500 repo fleets without adding webhook infrastructure complexity.

1. **Due-time detector scheduling (per repo)** (DONE)
   - Track `nextCommitCheckAt` and `nextPrCheckAt` per repo.
   - Process only due repos each detector tick, not full-repo scans every interval.

2. **Simple idle backoff policy (safe mode)** (DONE)
   - Fast lane for active repos: ~15s probe cadence.
   - Idle lane for unchanged repos: ~60s probe cadence.
   - Keep backoff simple (15s -> 60s only), no complex exponential detector backoff.
   - Use fixed detector error cooldown (30s).

3. **Async probe execution with bounded concurrency** (DONE)
   - Replace sync detector subprocess calls with async probes.
   - Add per-probe timeout (10s) and a bounded worker pool (`probeConcurrency`).

4. **Persist lightweight probe state in DB** (DONE)
   - Migration v5 adds repo-level probe state fields:
     - `next_commit_check_at`
     - `next_pr_check_at`
     - `idle_streak`
     - `last_pr_checked_at`
   - Preserves probe scheduler continuity across daemon restarts.

5. **Reduce `gh pr view` frequency** (DONE)
   - Gate PR checks by `prTtlSec` (default 300s).
   - Avoids PR CLI calls on every detector cycle for idle repos.

6. **Config surface extension** (DONE)
   - `[detector]` section with conservative defaults:
     - `minPollSec` (15)
     - `maxPollSec` (60)
     - `probeConcurrency` (4)
     - `prTtlSec` (300)
     - `pollJitterPct` (10)

Clean break: old fixed-interval detector replaced entirely; no feature flag, no legacy path.

### P2 - Phase 7 Dashboard

1. Use daemon cursor + SSE primitives from P1.5 (step 10).
2. Build Ink dashboard (repo status, agent strip, activity log, keybinds).
3. Keep dashboard read-only over event journal + state queries.

### P3 - Phase 8/9 Hardening

1. Production command polish (`start/stop/status/review/log/config`).
2. systemd/launchd guidance.
3. Recovery and chaos tests (stream drop, server crash, daemon restart, stuck session timeout).

## Verification Standard

Run after each meaningful commit:

- `bun run --filter @opencode-janitor/cli typecheck`
- `bun run --filter @opencode-janitor/cli build`
- `bun run --filter './packages/*' typecheck`
- `bun run --filter './packages/*' build`

P1.6 behavioral verification (required before full rollout):

- Probe volume reduction on mostly idle fleets:
  - commit probes reduced by >= 10x,
  - PR probes reduced by >= 20x.
- Trigger correctness:
  - no duplicate enqueue regression (> 0.5% increase),
  - no missed-trigger regression in canary repos.
- Latency:
  - p95 active-repo detection delay <= 45s,
  - queue time-to-start p95 <= 180s under sustained churn tests.
- Restart continuity:
  - persisted `next_*_check_at` state prevents restart stampede behavior.

## Exit Criteria Before Plugin Slim-Down

- Scheduler/runner architecture is modular and testable.
- Multi-agent async flow is stable under retries/restarts (24h soak without restart/retry regressions).
- Event stream and dashboard are operational (stream reconnect success >= 99%).
- Daemon owns the full runtime lifecycle cleanly (no shutdown race causing lost run/finding writes in validation runs).
