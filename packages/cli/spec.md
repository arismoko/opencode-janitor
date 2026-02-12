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

## Session Event Model (Dashboard)

- Session journal entries are projected from SDK events into typed topics:
  - `session.delta`
  - `session.text`
  - `session.tool.start`
  - `session.tool.completed`
  - `session.tool.error`
  - `session.step.start`
  - `session.step.finish`
  - `session.idle`
  - `session.error`
- All session topics persisted to `event_journal` must include correlated IDs from the running review context:
  - `repoId`
  - `triggerEventId`
  - `reviewRunId`
- Scheduler lifecycle topics (`review_run.succeeded`, `review_run.failed`, `review_run.requeued`) must also include `reviewRunId` and `triggerEventId` in both journal columns and payload.
- Dashboard report detail exposes two session modes:
  - `session` (structured timeline with tool cards, step boundaries, and lifecycle separators)
  - `session-raw` (raw transcript view)

## Dashboard Meta Semantics

- Reports meta shows **Default branch** (from repo `default_branch`) instead of a generic "Branch" label.
- Reports meta shows **Last event** from `latestEventTs`; there is no next-check field in the read model.
- Read models do not surface legacy idle/check scheduling fields (`idleStreak`, `nextCommitCheckAt`, `nextPrCheckAt`).

## Quality Gates

- Required checks:
  - `bun run typecheck`
  - `bun test`
  - `bun run build`
- Hygiene invariants:
  - no legacy strategy/profile imports
  - no hardcoded agent lists outside canonical registries
  - no trigger inference from subject-key parsing in runtime planner/scheduler paths
