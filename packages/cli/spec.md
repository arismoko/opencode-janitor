# CLI Runtime Spec (Refactor)

## Non-Negotiables

- Greenfield runtime: no migration shims or compatibility wrappers.
- Canonical source of truth is `@opencode-janitor/shared` registries:
  - `AGENTS`
  - `TRIGGERS`
  - `SCOPES`
- Runtime flow is event-first:
  - trigger probe/manual request -> `trigger_events`
  - planner -> `review_runs`
  - scheduler executes `review_runs`
  - findings + journal persisted
- Manual PR semantics are fixed:
  - trigger is always `manual`
  - scope is `pr`

## Runtime Architecture

- `packages/cli/src/triggers/modules/*`: trigger-specific probe/build behavior.
- `packages/cli/src/triggers/engine.ts`: polls enabled trigger modules and inserts deduped `trigger_events`.
- `packages/cli/src/runtime/planner.ts`: resolves eligible agents + scope and enqueues `review_runs`.
- `packages/cli/src/scheduler/worker.ts`: claims queued `review_runs`, runs one agent per run, persists outcomes.
- `packages/cli/src/runtime/definition-agent-registry.ts`: registers runtime specs from `AGENTS` definitions.

## Persistence Model

- `trigger_states`: generic per-repo trigger cursor/state.
- `trigger_events`: immutable trigger emissions with `(repo_id, trigger_id, event_key)` dedupe.
- `review_runs`: execution queue and result record keyed by `(trigger_event_id, agent)`.
- `findings`: linked to `review_run_id`.
- `event_journal`: operational event stream with optional run/event references.

## API Surface

- `POST /v1/reviews/enqueue`
  - body: `{ repoOrId, agent, scope?, input?, note? }`
  - creates a manual trigger event and plans review runs.
- `GET /v1/capabilities`
  - returns capability view derived from `AGENTS/TRIGGERS/SCOPES`.
- `GET /v1/dashboard/*`, `GET /v1/events*`
  - dashboard/event read model endpoints.

## CLI Surface

- Agent commands are generated from `AGENTS` + `SCOPES` via `agent-command-factory`.
- Scope CLI options come from scope definitions (e.g. PR scope contributes `--pr <number>`).

## Quality Gates

- Required checks:
  - `bun run typecheck`
  - `bun test`
  - `bun run build`
- Hygiene invariants:
  - no legacy strategy/profile imports
  - no hardcoded agent lists outside canonical registries
  - no trigger inference from subject-key parsing in runtime planner/scheduler paths
