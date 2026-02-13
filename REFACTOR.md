Agent + Trigger Runtime Rewrite Plan (Hard Cut)
This document defines a full infrastructure rewrite for agent execution, trigger detection, and manual review entrypoints.
This is a clean break. No migration shims, no compatibility wrappers, no partial adapters.
Locked Decisions

- Full infra rewrite in one PR (commit-by-commit), not incremental patching.
- `AGENTS` is the canonical source for agent behavior and capabilities.
- Triggers are self-contained modules.
- Runtime is event-centered: trigger modules emit events, planner creates runs, executor runs agents.
- Manual `--pr` uses clean semantics:
  - trigger remains `manual`
  - scope resolves to `pr`
- CLI commands and dashboard capabilities are generated from canonical definitions (no hardcoded agent list).
  Goals
- One canonical source of truth for agents, triggers, and scopes.
- Eliminate hardcoded assumptions about the four current agents.
- Make trigger infrastructure generic enough to add arbitrary trigger modules.
- Keep behavior parity where expected, while cleaning semantics and architecture.
- Reduce mental load by replacing special-case flow with explicit contracts.
  Non-Goals
- No backward-compatibility layer for old runtime internals.
- No legacy schema migration chain.
- No new product features beyond architecture and parity-preserving UX.
  Current Problems
  Behavior is fragmented and hardcoded across:
- agent identity and prompts (`packages/shared/src/review/agent-profiles.ts`)
- output schemas (`packages/shared/src/schemas/finding.ts`)
- strategy-specific runtime logic (`packages/cli/src/reviews/strategies/*.ts`)
- runtime registry wiring (`packages/cli/src/runtime/default-agent-specs.ts`)
- hardcoded CLI commands (`packages/cli/src/commands/review.ts`)
- hardcoded dashboard agent list (`packages/cli/src/daemon/frontend/constants.js`)
- trigger logic hardcoded to commit/pr in DB schema and detector flow (`packages/cli/src/db/migrations.ts`, `packages/cli/src/detectors/repo-watch.ts`)
  Target Architecture
  Canonical Registries
  Create three registries and derive all names/types from them:
- `AGENTS`
- `TRIGGERS`
- `SCOPES`
  No separate hand-maintained unions/lists.
  export const AGENTS = { ... } as const;
  export const TRIGGERS = { ... } as const;
  export const SCOPES = { ... } as const;
  export type AgentId = keyof typeof AGENTS;
  export type TriggerId = keyof typeof TRIGGERS;
  export type ScopeId = keyof typeof SCOPES;
  Trigger/Scope Coupling Model
  Triggers and scopes are separate axes with explicit constraints:
- trigger = why a run exists
- scope = what context is reviewed
  Coupling is via compatibility rules, not implicit conditionals:
- each trigger defines:
  - `defaultScope`
  - `allowedScopes`
- each agent defines:
  - manual-capable scopes
  - scope resolver for manual requests
    Runtime Topology
    Trigger Modules (auto/manual)
    -> trigger_events
    -> Planner (agent + scope resolution)
    -> review_runs queue
    -> Executor (agent runtime)
    -> findings + event_journal
    Manual and auto flows share the same pipeline after event emission.
    Definition Contracts
    Agent Definition
    type AgentContextMeta = {
    label?: string;
    metadataPrefix?: string[];
    metadataSuffix?: string[];
    reason?: 'manual-repo' | 'empty-workspace-fallback';
    };
    type ResolveManualScopeInput = {
    requestedScope?: ScopeId;
    hasWorkspaceDiff: boolean;
    manualInput?: Record<string, unknown>;
    trigger: 'manual';
    };
    type EnrichContextInput = {
    trigger: TriggerId;
    scope: ScopeId;
    repoPath: string;
    defaultBranch: string;
    hasWorkspaceDiff: boolean;
    sha?: string;
    prNumber?: number;
    };
    export type AgentDefinition = {
    id: AgentId;
    label: string;
    description: string;
    role: string;
    domains: readonly string[];
    rules?: string;
    outputSchema: z.ZodTypeAny;
    defaults: {
    autoTriggers: readonly TriggerId[];
    manualScope?: ScopeId;
    maxFindings?: number;
    };
    capabilities: {
    autoTriggers: readonly TriggerId[];
    manualScopes: readonly ScopeId[];
    };
    cli: {
    command: string;
    alias?: string;
    description: string;
    };
    resolveManualScope: (input: ResolveManualScopeInput) => ScopeId;
    enrichContext: (input: EnrichContextInput) => AgentContextMeta;
    reviewPromptHints?: (input: EnrichContextInput) => string[];
    };
    Hard gate semantics for auto runs:
    eligible =
    agent.enabled &&
    config.autoTriggers.includes(triggerId) &&
    agent.capabilities.autoTriggers.includes(triggerId);
    Config may narrow capability; it cannot expand it.
    Trigger Definition
    type TriggerProbeResult<TState, TPayload> = {
    nextState: TState;
    emissions: Array<{
    eventKey: string;
    payload: TPayload;
    detectedAt: number;
    }>;
    };
    type TriggerContext = {
    trigger: TriggerId;
    subject: string;
    metadata: string[];
    sha?: string;
    prNumber?: number;
    };
    export type TriggerDefinition<TState = unknown, TPayload = unknown> = {
    id: TriggerId;
    label: string;
    description: string;
    mode: 'auto' | 'manual' | 'both';
    configSchema: z.ZodTypeAny;
    stateSchema: z.ZodType<TState>;
    payloadSchema: z.ZodType<TPayload>;
    defaultScope: ScopeId | null;
    allowedScopes: readonly ScopeId[];
    probe?: (input: {
    repoPath: string;
    state: TState;
    config: unknown;
    }) => Promise<TriggerProbeResult<TState, TPayload>>;
    fromManualRequest?: (input: unknown, repoPath: string) => Promise<TPayload>;
    buildSubject: (payload: TPayload) => string;
    buildTriggerContext: (input: {
    repoPath: string;
    payload: TPayload;
    subject: string;
    }) => Promise<TriggerContext>;
    };
    Scope Definition
    type ScopeCliOption = {
    flag: string; // e.g. "--pr <number>"
    key: string; // e.g. "prNumber"
    description: string;
    required?: boolean;
    };
    export type ScopeDefinition<TInput = unknown> = {
    id: ScopeId;
    label: string;
    description: string;
    inputSchema?: z.ZodType<TInput>;
    cliOptions?: readonly ScopeCliOption[];
    buildReviewContext: (input: {
    repoPath: string;
    triggerContext: TriggerContext;
    manualInput?: TInput;
    }) => Promise<ReviewContext>;
    };
    Built-In Trigger and Scope Modules
    Built-In Triggers
- `commit` (auto)
- `pr` (auto)
- `manual` (manual)
  Built-In Scopes
- `commit-diff`
- `workspace-diff`
- `repo`
- `pr`
  Default coupling:
- `commit` -> default scope `commit-diff`
- `pr` -> default scope `pr`
- `manual` -> scope resolved by agent hook and manual request input
  Agent Capability Matrix (Parity + Clean Semantics)
- `janitor`
  - auto-capable: `commit`, `pr`
  - default auto triggers: `commit`
  - manual scopes: `workspace-diff`, `repo`
- `hunter`
  - auto-capable: `commit`, `pr`
  - default auto triggers: `pr`
  - manual scopes: `workspace-diff`, `repo`, `pr`
- `inspector`
  - auto-capable: `commit`, `pr`
  - default auto triggers: none
  - manual scopes: `repo`
- `scribe`
  - auto-capable: `commit`, `pr`
  - default auto triggers: none
  - manual scopes: `repo`
    Manual `--pr` semantics:
- request trigger is always `manual`
- scope resolves to `pr` when supported and input validates
  Database Rewrite (Generic Trigger Infra)
  Replace trigger-specific repo columns and job layering with generic event/run model.
  New/Updated Tables
- `repos`
  - keep repo identity + enabled/paused/default branch
  - remove trigger-specific state columns (`last_head_sha`, `last_pr_key`, `next_*`)
- `trigger_states`
  - `(repo_id, trigger_id)` unique
  - generic state blob and scheduling cursor
  - `state_json`, `next_check_at`, `last_checked_at`, `updated_at`
- `trigger_events`
  - immutable detected/manual trigger events
  - `trigger_id`, `event_key`, `subject`, `payload_json`, `source`, `detected_at`
  - unique `(repo_id, trigger_id, event_key)`
- `review_runs`
  - queue + execution record per `(trigger_event, agent)`
  - `agent`, `scope`, `scope_input_json`, status/attempt/retry/session/output fields
  - unique `(trigger_event_id, agent)`
- `findings`
  - attached to `review_run_id` (not agent-run under job)
- `event_journal`
  - references `review_run_id` and `trigger_event_id` as needed
    This removes trigger-specific schema assumptions and the old `review_jobs` + `agent_runs` split.
    Config Redesign
    Replace trigger enum (`commit/pr/both/manual/never`) with explicit arrays and dynamic keys.
    Example (JSON):
    {
      "agents": {
        "janitor": {
          "enabled": true,
          "autoTriggers": ["commit"],
          "manualDefaultScope": "workspace-diff",
          "maxFindings": 10,
          "modelId": "",
          "variant": ""
        }
      },
      "triggers": {
        "commit": {
          "enabled": true,
          "intervalSec": 15
        },
        "pr": {
          "enabled": true,
          "intervalSec": 30
        },
        "manual": {
          "enabled": true
        }
      }
    }
    Rules:
- `agents.<id>.autoTriggers` must be subset of both:
  - registered trigger ids
  - `agent.capabilities.autoTriggers`
- unknown trigger ids fail config validation at startup
- trigger module config is validated by module-local `configSchema`
  CLI Command Factory
  Generate agent subcommands from `AGENTS` + `SCOPES`:
- one subcommand per agent using `agent.cli.command`
- alias from `agent.cli.alias`
- description from `agent.cli.description`
- add `--scope <scope>` choices from `agent.capabilities.manualScopes`
- add scope-specific options from `SCOPES[scope].cliOptions`
- validate options against chosen/resolved scope
- enqueue manual request as structured payload
  Manual enqueue request shape:
  {
  "repoOrId": "/path/or/repo-id",
  "agent": "hunter",
  "scope": "pr",
  "input": {
  "prNumber": 123
  }
  }
  No agent-specific one-off flags in route validation logic.
  Dashboard Capability Generation
  Remove hardcoded frontend constants. Use daemon-provided capabilities endpoint:
- `GET /v1/capabilities`
  - agents: id/label/description/manual scopes/cli metadata
  - scopes: id/label + required inputs
  - triggers: id/label/mode
    Manual modal is rendered from this payload.
    Prompt Architecture After Rewrite
- system prompt comes from `AGENTS[agent]` fields:
  - `role`, `domains`, `rules`, `outputSchema`
- review prompt comes from shared builder + scope context
- optional `reviewPromptHints` appended from agent definition
- no strategy-specific prompt assembly files
  Hardcoded Surfaces To Eliminate
  These must be removed or rewritten to use canonical registries:
- `packages/shared/src/types/agent.ts` hardcoded union/list
- `packages/shared/src/review/agent-profiles.ts`
- `packages/shared/src/schemas/finding.ts`
- `packages/cli/src/commands/review.ts` hardcoded subcommands/options
- `packages/cli/src/daemon/frontend/constants.js` hardcoded agents
- `packages/cli/src/daemon/http/validation.ts` hardcoded error string list
- `packages/cli/src/runtime/default-agent-specs.ts` hardcoded per-agent wiring
- `packages/cli/src/config/schema.ts` hardcoded `agents` object keys and trigger enum defaults
- `packages/cli/src/detectors/repo-watch.ts` commit/pr-specific scheduling logic
- `packages/cli/src/db/migrations.ts` trigger kind check hardcoded to commit/pr/manual
- `packages/cli/src/reviews/context.ts` trigger behavior inferred from subject-key parsing
  File-by-File Refactor Plan
  Create
- `packages/shared/src/agents/types.ts`
- `packages/shared/src/agents/define-agent.ts`
- `packages/shared/src/agents/definitions/*.ts`
- `packages/shared/src/agents/index.ts`
- `packages/shared/src/triggers/types.ts`
- `packages/shared/src/triggers/definitions/*.ts`
- `packages/shared/src/triggers/index.ts`
- `packages/shared/src/scopes/types.ts`
- `packages/shared/src/scopes/definitions/*.ts`
- `packages/shared/src/scopes/index.ts`
- `packages/shared/src/capabilities/index.ts`
- `packages/shared/src/capabilities.test.ts`
- `packages/cli/src/triggers/engine.ts`
- `packages/cli/src/triggers/state-store.ts`
- `packages/cli/src/triggers/modules/commit.ts`
- `packages/cli/src/triggers/modules/pr.ts`
- `packages/cli/src/triggers/modules/manual.ts`
- `packages/cli/src/runtime/planner.ts`
- `packages/cli/src/runtime/review-run-context.ts`
- `packages/cli/src/runtime/agent-spec-from-definition.ts`
- `packages/cli/src/commands/agent-command-factory.ts`
- `packages/cli/src/daemon/routes/capabilities.ts`
- `packages/cli/src/daemon/frontend/state/use-capabilities.js`
- `packages/cli/src/daemon/frontend/components/capability-driven-manual-modal.js`
- `packages/cli/src/runtime/planner.test.ts`
- `packages/cli/src/triggers/engine.test.ts`
- `packages/cli/src/commands/agent-command-factory.test.ts`
  Modify
- `packages/shared/src/index.ts` (export new canonical modules)
- `packages/shared/src/types/review.ts` (align scope/context model)
- `packages/shared/src/review/prompt-builder.ts` (hints + scope metadata)
- `packages/shared/src/review/output-codec.test.ts` (schemas from `AGENTS`)
- `packages/cli/src/config/schema.ts` (dynamic agent/trigger config)
- `packages/cli/src/runtime/bootstrap.ts` (wire trigger engine + planner)
- `packages/cli/src/scheduler/worker.ts` (consume `review_runs`)
- `packages/cli/src/db/migrations.ts` (new generic schema)
- `packages/cli/src/db/models.ts` (new row models)
- `packages/cli/src/db/queries/*` (run/event/state query layer rewrite)
- `packages/cli/src/daemon/routes/reviews.ts` (new manual request shape)
- `packages/cli/src/daemon/frontend/*` (consume `/v1/capabilities`)
- `packages/cli/src/ipc/protocol.ts` (remove hunter-specific `pr` contract)
- `packages/cli/src/commands/review.ts` (delegate to command factory)
- `packages/cli/src/db/queries/dashboard-queries.ts` (read from `review_runs`)
  Delete
- `packages/shared/src/review/agent-profiles.ts`
- `packages/shared/src/schemas/finding.ts`
- `packages/shared/src/types/agent.ts` (or replace with derived exports only)
- `packages/cli/src/reviews/strategies/base-agent-spec.ts`
- `packages/cli/src/reviews/strategies/janitor-strategy.ts`
- `packages/cli/src/reviews/strategies/hunter-strategy.ts`
- `packages/cli/src/reviews/strategies/inspector-strategy.ts`
- `packages/cli/src/reviews/strategies/scribe-strategy.ts`
- `packages/cli/src/reviews/strategies/build-doc-index.ts` (move to scope/runtime hooks)
- `packages/cli/src/reviews/strategies/strategies.test.ts`
- `packages/cli/src/runtime/default-agent-specs.ts`
- `packages/cli/src/daemon/frontend/constants.js`
- `packages/cli/src/detectors/repo-watch.ts` (replaced by generic trigger engine)
  Validation Checklist
- `bun run typecheck`
- `bun test`
- `bun run build`
- grep checks:
  - no imports from deleted strategy/profile/schema files
  - no hardcoded agent-name union/list outside canonical registries
  - no hardcoded trigger kind unions in runtime/DB/query layers
  - no runtime logic that parses subject key to infer trigger behavior
    Acceptance Criteria
- Adding a new agent requires:
  - one definition file + registry entry
  - no CLI/dashboard/manual route hardcoded edits
- Adding a new trigger requires:
  - one trigger module + registry entry + config section
  - no DB schema edits for trigger-specific state fields
- Manual `hunter --pr` enqueues `trigger=manual` and resolves `scope=pr`
- Runtime behavior is decided from structured trigger/scope payload, not subject-key parsing
- Dashboard and CLI show capabilities from canonical definitions
- Existing default behavior is preserved:
  - janitor auto on commit
  - hunter auto on PR
  - inspector/scribe manual-first defaults
  - same manual scope behavior as specified above
    Out of Scope
- New end-user features beyond capability-driven parity.
- Legacy compatibility pathways.
- Multi-version migration support.
