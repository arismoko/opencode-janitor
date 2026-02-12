# Commit Execution Plan (Single PR)

This is the concrete commit-by-commit execution sequence for the hard-cut runtime rewrite defined in `REFACTOR.md`.

## Operating Rules

- One PR, many focused commits.
- No compatibility shims/adapters for legacy runtime behavior.
- No trigger or agent hardcoding outside canonical registries.
- Manual `--pr` semantics are locked:
  - trigger remains `manual`
  - scope resolves to `pr`
- Every commit must leave the repo in a buildable state.

## Verification Policy

- Per commit minimum:
  - `bun run typecheck`
  - targeted tests for touched modules
- Milestone commits run full checks:
  - `bun run typecheck`
  - `bun test`
  - `bun run build`
- Final commit also runs grep hygiene checks from `REFACTOR.md`.

## Commit Sequence

### C01 - docs: lock rewrite contract and execution plan

**Intent**

- Freeze architecture and acceptance criteria before code churn.

**Changes**

- finalize `REFACTOR.md`
- add `COMMITS.md`

**Verify**

- no runtime checks required

---

### C02 - refactor(shared): add canonical registries for agents, triggers, scopes

**Intent**

- Create `AGENTS`, `TRIGGERS`, `SCOPES` as single source of truth.

**Changes**

- add `packages/shared/src/agents/types.ts`
- add `packages/shared/src/agents/define-agent.ts`
- add `packages/shared/src/agents/definitions/{janitor,hunter,inspector,scribe}.ts`
- add `packages/shared/src/agents/index.ts`
- add `packages/shared/src/triggers/types.ts`
- add `packages/shared/src/triggers/definitions/{commit,pr,manual}.ts`
- add `packages/shared/src/triggers/index.ts`
- add `packages/shared/src/scopes/types.ts`
- add `packages/shared/src/scopes/definitions/{commit-diff,workspace-diff,repo,pr}.ts`
- add `packages/shared/src/scopes/index.ts`
- add `packages/shared/src/capabilities/index.ts`
- add `packages/shared/src/capabilities.test.ts`
- export all new modules from `packages/shared/src/index.ts`

**Notes**

- Keep old strategy/profile files in place for now; do not wire runtime yet.

**Verify**

- `bun run typecheck`
- `bun test packages/shared/src/capabilities.test.ts`

---

### C03 - refactor(shared): move output schema ownership to AGENTS and align prompt contracts

**Intent**

- Make agent-owned output schemas and hooks the prompt/runtime source.

**Changes**

- update `packages/shared/src/review/prompt-builder.ts` to support scope metadata and optional hints
- update `packages/shared/src/types/review.ts` for trigger/scope context shape
- update `packages/shared/src/review/output-codec.ts` to parse from `AGENTS[agent].outputSchema`
- update `packages/shared/src/review/output-codec.test.ts` to validate definition-owned schemas
- update shared type exports that referenced old finding/profile modules

**Notes**

- Do not delete old files yet; runtime still references them until cutover.

**Verify**

- `bun run typecheck`
- `bun test packages/shared/src/review/output-codec.test.ts`

---

### C04 - refactor(config): redesign config schema around dynamic agent and trigger registries

**Intent**

- Replace static trigger mode enum and hardcoded agent keys with registry-derived config.

**Changes**

- rewrite `packages/cli/src/config/schema.ts`
- rewrite `packages/shared/src/schemas/config.ts` usage from static `TriggerMode` to dynamic sets
- update `packages/cli/src/config/schema.test.ts`
- enforce hard capability gate validation:
  - configured auto triggers must be subset of agent capabilities
  - unknown triggers/scopes fail startup validation

**Verify**

- `bun run typecheck`
- `bun test packages/cli/src/config/schema.test.ts`

---

### C05 - refactor(db): replace job model with trigger_events + review_runs + trigger_states

**Intent**

- Introduce generic trigger infra in persistence and remove trigger-specific repo columns.

**Changes**

- rewrite `packages/cli/src/db/migrations.ts`
- rewrite `packages/cli/src/db/models.ts`
- update `packages/cli/src/db/queries.test.ts` schema fixture
- update enum literal helpers if needed

**Schema Targets**

- remove trigger-specific repo fields (`last_head_sha`, `last_pr_key`, `next_commit_check_at`, `next_pr_check_at`, `last_pr_checked_at`)
- add `trigger_states`
- add `trigger_events`
- add `review_runs`
- move findings foreign key to `review_run_id`

**Verify**

- `bun run typecheck`
- `bun test packages/cli/src/db/queries.test.ts`

**Milestone Gate A**

- `bun run typecheck`
- `bun test`
- `bun run build`

---

### C06 - refactor(db): add query layer for trigger events, trigger states, and review runs

**Intent**

- Provide query primitives for trigger engine, planner, executor, and dashboard.

**Changes**

- add/replace query modules under `packages/cli/src/db/queries/`:
  - trigger state queries
  - trigger event insert/claim queries
  - review run insert/claim/update queries
  - findings persistence updates for `review_run_id`
- update `packages/cli/src/db/queries/dashboard-queries.ts` to read `review_runs`

**Verify**

- `bun run typecheck`
- targeted query tests for new modules

---

### C07 - refactor(triggers): implement trigger modules (commit, pr, manual)

**Intent**

- Move trigger logic into self-contained modules with schemas and probe/build behavior.

**Changes**

- add `packages/cli/src/triggers/modules/commit.ts`
- add `packages/cli/src/triggers/modules/pr.ts`
- add `packages/cli/src/triggers/modules/manual.ts`
- add `packages/cli/src/triggers/state-store.ts`
- introduce module tests for probe/state transitions

**Notes**

- This replaces detector-specific assumptions in preparation for engine cutover.

**Verify**

- `bun run typecheck`
- trigger module tests

---

### C08 - refactor(triggers): add generic trigger engine and remove repo-watch integration path

**Intent**

- Centralize auto-trigger polling/emission in one engine over trigger registry.

**Changes**

- add `packages/cli/src/triggers/engine.ts`
- add `packages/cli/src/triggers/engine.test.ts`
- wire engine startup/stop in `packages/cli/src/runtime/bootstrap.ts`
- stop using `packages/cli/src/detectors/repo-watch.ts`

**Verify**

- `bun run typecheck`
- `bun test packages/cli/src/triggers/engine.test.ts`

---

### C09 - refactor(runtime): add planner from trigger_events to review_runs

**Intent**

- Resolve agent eligibility and scope in one planner using canonical definitions.

**Changes**

- add `packages/cli/src/runtime/planner.ts`
- add `packages/cli/src/runtime/planner.test.ts`
- planner rules:
  - hard-gated auto eligibility
  - manual scope resolution via agent hooks
  - no subject-key parsing to infer trigger semantics

**Verify**

- `bun run typecheck`
- `bun test packages/cli/src/runtime/planner.test.ts`

---

### C10 - refactor(runtime): add definition-based agent runtime adapter and review context builder

**Intent**

- Build prompts and parse output from agent definitions, not strategy classes.

**Changes**

- add `packages/cli/src/runtime/agent-spec-from-definition.ts`
- add `packages/cli/src/runtime/review-run-context.ts`
- update `packages/cli/src/runtime/agent-runtime-spec.ts` shape
- update `packages/cli/src/runtime/agent-factory.ts` to consume `AGENTS`
- update `packages/cli/src/runtime/agent-factory.test.ts`

**Verify**

- `bun run typecheck`
- `bun test packages/cli/src/runtime/agent-factory.test.ts`

---

### C11 - refactor(scheduler): execute review_runs and persist outcomes in new schema

**Intent**

- Cut scheduler/executor over from review_jobs/agent_runs to review_runs.

**Changes**

- rewrite `packages/cli/src/scheduler/worker.ts`
- rewrite `packages/cli/src/scheduler/job-executor.ts`
- update `packages/cli/src/scheduler/agent-execution-pipeline.ts`
- update outcome writer/retry flow for new run model
- ensure findings persistence writes `review_run_id`

**Verify**

- `bun run typecheck`
- scheduler pipeline tests

**Milestone Gate B**

- `bun run typecheck`
- `bun test`
- `bun run build`

---

### C12 - refactor(api): change manual enqueue contract to agent/scope/input

**Intent**

- Remove hunter-specific PR special case from API and runtime payload model.

**Changes**

- rewrite `packages/cli/src/ipc/protocol.ts`
- rewrite `packages/cli/src/daemon/routes/reviews.ts`
- rewrite `packages/cli/src/daemon/http/validation.ts`
- rewrite `packages/cli/src/daemon/options/review-options.ts`
- rewrite `packages/cli/src/runtime/review-job-payload.ts` (or replacement run payload contract)

**Behavior Lock**

- manual `pr` input maps to `trigger=manual`, `scope=pr`.

**Verify**

- `bun run typecheck`
- daemon route/validation tests

---

### C13 - refactor(cli): generate agent commands from AGENTS and SCOPES

**Intent**

- Replace hardcoded subcommands and options with a command factory.

**Changes**

- add `packages/cli/src/commands/agent-command-factory.ts`
- add `packages/cli/src/commands/agent-command-factory.test.ts`
- update `packages/cli/src/commands/review.ts` to register commands dynamically

**Verify**

- `bun run typecheck`
- command factory tests

---

### C14 - refactor(daemon): expose capabilities API and drive frontend modal dynamically

**Intent**

- Remove frontend hardcoded agent list and source UI from canonical definitions.

**Changes**

- add `packages/cli/src/daemon/routes/capabilities.ts`
- wire route in daemon socket/router
- add `packages/cli/src/daemon/frontend/state/use-capabilities.js`
- add `packages/cli/src/daemon/frontend/components/capability-driven-manual-modal.js`
- update dashboard app components to consume capabilities endpoint
- delete `packages/cli/src/daemon/frontend/constants.js`

**Verify**

- `bun run typecheck`
- daemon socket/dashboard frontend tests

---

### C15 - refactor(cleanup): delete legacy strategies, profiles, schemas, and detector code

**Intent**

- Remove all superseded architecture and dead code paths.

**Changes**

- delete `packages/cli/src/reviews/strategies/*`
- delete `packages/cli/src/runtime/default-agent-specs.ts`
- delete `packages/cli/src/detectors/repo-watch.ts`
- delete `packages/shared/src/review/agent-profiles.ts`
- delete `packages/shared/src/schemas/finding.ts`
- delete or replace `packages/shared/src/types/agent.ts` with registry-derived exports only
- remove old imports and tests tied to deleted modules

**Verify**

- `bun run typecheck`
- `bun test`

---

### C16 - test/docs: full rewrite verification, grep hygiene, and spec updates

**Intent**

- Lock final quality gates and update architecture docs to match implementation.

**Changes**

- update `packages/cli/spec.md` and any architecture docs
- update/replace test suites for new runtime model
- add regression tests for:
  - manual `scope=pr` with `trigger=manual`
  - hard capability gate behavior
  - dynamic command generation and capabilities endpoint
- remove stale references to deleted files/types

**Verify (mandatory)**

- `bun run typecheck`
- `bun test`
- `bun run build`
- grep hygiene:
  - no imports from deleted strategy/profile/schema modules
  - no hardcoded agent union/list outside canonical registries
  - no hardcoded trigger union checks in runtime/db/query layers
  - no trigger inference from subject-key parsing

## Suggested Commit Message Prefixes

- `docs:` for plan/spec updates
- `refactor(shared):`
- `refactor(config):`
- `refactor(db):`
- `refactor(triggers):`
- `refactor(runtime):`
- `refactor(scheduler):`
- `refactor(api):`
- `refactor(cli):`
- `refactor(daemon):`
- `test:` for pure test additions

## PR Exit Criteria

- All acceptance criteria in `REFACTOR.md` are satisfied.
- No legacy strategy/profile/schema code paths remain.
- New agent and trigger addition requires only definition/module + registry entry.
- Manual `--pr` flow is clean semantics (`manual` trigger, `pr` scope).
- Full typecheck/test/build pass on CI.
