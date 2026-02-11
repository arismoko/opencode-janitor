Clean-break daemon spec for `packages/cli` (Bun-native, no legacy paths).

## 0) Non-Negotiables

- Clean break only: no JSON config fallback, no plugin lifecycle reuse, no legacy state files.
- Source of truth split: `packages/shared` owns domain/schema/git primitives; `packages/cli` owns runtime/daemon/IPC/TUI.
- SQLite is authoritative runtime state; Ink dashboard is a read model over daemon events.
- IPC split is strict: HTTP JSON for commands/query, WebSocket for live stream.

---

## 1) Package Structure

### `packages/cli/src/`

```txt
src/
  index.ts                     # commander entrypoint
  commands/
    start.ts
    stop.ts
    status.ts
    config.ts
    add.ts
    remove.ts
    review.ts
    log.ts
  daemon/
    main.ts                    # internal daemon bootstrap (invoked by start --daemon)
    lifecycle.ts               # startup/shutdown orchestration
    lock.ts                    # single-instance lock + stale pid handling
    socket.ts                  # Bun.serve unix socket HTTP+WS server
    scheduler.ts               # central queue/concurrency coordinator
    recovery.ts                # restart recovery, orphan job reconciliation
  detectors/
    repo-watch.ts              # per-repo detector supervisor
    commit-detector.ts         # adapted from shared primitives
    pr-detector.ts
  reviews/
    orchestrator.ts            # per-job multi-agent flow
    context-resolver.ts        # commit/pr/manual context assembly
    session-manager.ts         # hub+child session lifecycle
    parser.ts                  # parse/validate model JSON output
  db/
    connection.ts              # bun:sqlite open/pragma/close
    migrations.ts              # schema migration runner
    queries.ts                 # prepared statements
    models.ts                  # DB row mappings
  ipc/
    client.ts                  # unix-socket fetch + ws client for CLI commands
    protocol.ts                # request/response/event TS types
    handlers.ts                # endpoint handlers
  dashboard/
    app.tsx
    state.ts                   # event reducer
    hooks.ts                   # ws subscription/input handlers
    components/
      Header.tsx
      RepoTable.tsx
      AgentStrip.tsx
      ActivityLog.tsx
      Footer.tsx
  config/
    schema.ts                  # zod schema for TOML
    loader.ts                  # Bun.TOML.parse + validation
    paths.ts                   # XDG path resolution
    writer.ts                  # atomic config writes
  utils/
    logger.ts                  # structured logs
    ids.ts                     # ulid/job ids
    time.ts
    errors.ts
    process.ts                 # Bun.spawn daemonization helpers
```

### `packages/shared/src/`

```txt
src/
  index.ts
  types/
    agent.ts
    finding.ts
    review.ts
    trigger.ts
  schemas/
    finding.ts                 # move from plugin as-is (Zod v4)
    config.ts                  # shared config fragments (agent settings)
  git/
    signal-detector.ts         # move, cleanup plugin coupling
    commit-detector.ts         # move; generic callback interfaces
    pr-detector.ts             # move
    commit-resolver.ts         # move; inject exec fn
    pr-context-resolver.ts     # move
    gh-pr.ts                   # move; keep gh logic pure
    review-key.ts              # move as-is
  review/
    agent-profiles.ts          # move with no plugin imports
    prompt-builder.ts          # move, generic context type
    output-codec.ts            # extracted parser/codec
```

### Package dependency graph

- `@opencode-janitor/shared`: no dependency on `cli` or `plugin`.
- `@opencode-janitor/cli` -> `@opencode-janitor/shared`, `@opencode-ai/sdk`, `commander`, `@clack/prompts`, `ink`, `react`, `bun:sqlite`, `chalk`, `zod`.
- `@opencode-janitor/plugin` (later slim) -> `@opencode-janitor/shared` only for shared domain logic.

---

## 2) Data Model

### SQLite location

- `${XDG_STATE_HOME:-~/.local/state}/opencode-janitor/daemon.db`

### SQL schema (authoritative)

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS daemon_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  git_dir TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)) DEFAULT 1,
  paused INTEGER NOT NULL CHECK (paused IN (0,1)) DEFAULT 0,
  last_head_sha TEXT,
  last_pr_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_repos_enabled ON repos(enabled, paused);

CREATE TABLE IF NOT EXISTS review_triggers (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('commit','pr','manual')),
  source TEXT NOT NULL CHECK (source IN ('fswatch','poll','tool-hook','cli','recovery')),
  subject_key TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  detected_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_triggers_repo_detected ON review_triggers(repo_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS review_jobs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  trigger_id TEXT REFERENCES review_triggers(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  cancel_requested INTEGER NOT NULL CHECK (cancel_requested IN (0,1)) DEFAULT 0,
  hub_session_id TEXT,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  error_code TEXT,
  error_message TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON review_jobs(status, priority, queued_at);
CREATE INDEX IF NOT EXISTS idx_jobs_repo_status ON review_jobs(repo_id, status);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES review_jobs(id) ON DELETE CASCADE,
  agent TEXT NOT NULL CHECK (agent IN ('janitor','hunter','inspector','scribe')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','skipped')),
  model_id TEXT,
  variant TEXT,
  session_id TEXT UNIQUE,
  findings_count INTEGER NOT NULL DEFAULT 0,
  raw_output TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  UNIQUE(job_id, agent)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_agent_runs_job_status ON agent_runs(job_id, status);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES review_jobs(id) ON DELETE CASCADE,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent TEXT NOT NULL CHECK (agent IN ('janitor','hunter','inspector','scribe')),
  severity TEXT NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  domain TEXT NOT NULL,
  location TEXT NOT NULL,
  evidence TEXT NOT NULL,
  prescription TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_findings_repo_created ON findings(repo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_findings_job_agent ON findings(job_id, agent);
CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);

CREATE TABLE IF NOT EXISTS event_journal (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
  event_type TEXT NOT NULL,
  repo_id TEXT,
  job_id TEXT,
  agent_run_id TEXT,
  message TEXT NOT NULL,
  payload_json TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_event_ts ON event_journal(ts DESC);
CREATE INDEX IF NOT EXISTS idx_event_repo_ts ON event_journal(repo_id, ts DESC);
```

### SQLite vs memory

- SQLite: repos, triggers, jobs, agent runs, findings, event journal, hub session id (`daemon_meta`).
- In-memory only: active detector handles, debounce timers, in-process queue heap, WS subscriber set, in-flight SDK client objects.

### Core runtime types

```ts
type AgentName = "janitor" | "hunter" | "inspector" | "scribe";
type TriggerKind = "commit" | "pr" | "manual";
type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
```

---

## 3) Daemon Architecture

### Startup sequence

- Resolve XDG paths for config/runtime/state.
- Acquire single-instance lock (`lock.ts`) using atomic lock file + PID verification.
- If PID exists and process dead, remove stale pid/lock/socket.
- Load TOML config, validate via Zod, fail-fast on invalid config.
- Open SQLite, run migrations, set PRAGMAs.
- Recover hub session id from `daemon_meta`; verify with SDK `session.get`, else create new hub.
- Start Bun HTTP+WS server on unix socket (`Bun.serve({ unix: socketPath, ... })`).
- Load enabled repos from DB, create detector supervisors.
- Recovery pass: `running` jobs -> `queued` with `attempt+1`, enqueue.
- Start scheduler tick loop and detector loops.
- Emit `daemon.started` event.

### Shutdown sequence

- Mark daemon state `draining=true`; stop accepting new enqueue except manual force.
- Stop detectors first (no new triggers).
- Cancel or finish running jobs based on `shutdown.grace_ms`.
- Flush pending DB writes and journal.
- Close WS clients with normal close code and reason.
- Close Bun server, close SQLite, remove socket/pid/lock.
- Emit terminal log and exit 0.

### Scheduler/event loop

- Single scheduler in daemon process; no per-command queue state.
- Enqueue writes trigger row + job row transactionally.
- Dequeue policy: priority then FIFO (`priority`, `queued_at`).
- Concurrency gates:
  - global active jobs <= `scheduler.globalConcurrency`
  - per repo active jobs <= `scheduler.perRepoConcurrency`
- Dedup: hard unique on `review_triggers.dedupe_key` and `review_jobs.dedupe_key`.
- Retry: failed job auto-requeue until `attempt == max_attempts`, exponential backoff.

### Git polling strategy

- Commit detection: fs watch acceleration + poll fallback; debounce required.
- PR detection: poll `gh pr view` current branch; debounce + key compare.
- Trigger key:
  - commit: `commit:<sha>`
  - pr: `pr:<number>:<headSha>` or branch fallback
  - manual: `manual:<timestamp>:<repoId>`
- Detector writes repo last seen keys into DB for observability.

### Review queue management

- One logical job per repo+subject key.
- Agent runs created as child rows (`agent_runs`) at job start.
- Agent execution strategy: parallel up to `scheduler.agentParallelism` (default 2).
- Job succeeds when all enabled agents are `succeeded` or `skipped`; fails if any required agent fails and retries exhausted.

### OpenCode session management

- One daemon hub session persisted in `daemon_meta["hub_session"]`.
- Each agent run creates child session with `parentID = hubSessionID`.
- Child sessions must be created with hidden/non-sidebar visibility flag per SDK type definitions (enforced during implementation against `sdk.gen.d.ts`).
- Prompt execution uses `session.prompt` (blocking) for deterministic completion and easier recovery.
- Store `session_id` on `agent_runs`; on crash recovery, rerun unfinished agent runs as new sessions.

---

## 4) IPC Protocol

### Transport

- Unix socket HTTP JSON for request/response.
- WebSocket endpoint for live event stream.

### HTTP endpoints

- `GET /v1/health` -> `{ ok: true, pid, version, uptimeMs }`
- `POST /v1/daemon/stop` -> `{ ok: true, draining: true }`
- `GET /v1/daemon/status` -> snapshot for TUI bootstrap
- `GET /v1/repos` -> tracked repos
- `POST /v1/repos` body `{ path: string }` -> created repo
- `DELETE /v1/repos/:id` -> `{ ok: true }`
- `POST /v1/repos/:id/pause` -> paused state
- `POST /v1/repos/:id/resume` -> resumed state
- `POST /v1/reviews` body `{ repoId: string, reason?: string }` -> enqueued job
- `GET /v1/logs?limit=100` -> recent events/jobs summary

### WS endpoint

- `GET /v1/events` upgrade to websocket.
- Event envelope:

```ts
type DaemonEvent = {
  seq: number;
  ts: number;
  type: string;
  payload: Record<string, unknown>;
};
```

- Required event types:
  - `daemon.started`, `daemon.draining`, `daemon.stopped`
  - `repo.added`, `repo.removed`, `repo.updated`, `repo.paused`, `repo.resumed`
  - `trigger.detected`, `job.queued`, `job.started`, `job.finished`, `job.failed`
  - `agent.started`, `agent.finished`, `agent.failed`
  - `finding.recorded`
  - `log.append`

### Error contract

- HTTP non-2xx:

```json
{
  "error": {
    "code": "REPO_NOT_FOUND",
    "message": "Repository does not exist",
    "details": {}
  }
}
```

- WS protocol errors are sent as `type: "error"` events; fatal protocol violations close socket.

---

## 5) CLI Commands

### Command behavior

- `<name> start`:
  - If daemon already running: print socket/pid and exit 0.
  - Else spawn detached daemon process (`Bun.spawn`, `unref`) with internal `--daemon` mode.
- `<name> stop`:
  - Send `POST /v1/daemon/stop`, wait until health check fails or timeout.
- `<name> status`:
  - Connect to daemon, render Ink dashboard; exits with `q`.
- `<name> config`:
  - Run `@clack/prompts` wizard, validate, write TOML atomically.
- `<name> add <repo>`:
  - Resolve absolute path, verify git repo, call `POST /v1/repos`.
- `<name> remove <repo>`:
  - Resolve path/id then call delete.
- `<name> review <repo>`:
  - Manual trigger via `POST /v1/reviews`.
- `<name> log`:
  - Print latest completed jobs/findings from `/v1/logs`.

### Flags

- Global: `--config <path>`, `--socket <path>`, `--json`.
- `start`: `--foreground`, `--no-detach`.
- `status`: `--no-color`, `--compact`.
- `log`: `--limit <n>`, `--repo <id|path>`.

### Daemon communication vs standalone

- `start/stop/status/add/remove/review/log` target daemon IPC.
- `config` is standalone file operation.
- If daemon is down and command is mutating repo state (`add/remove`), command fails with actionable message (no offline side writes).

---

## 6) TUI Dashboard (Ink v6)

### Component tree

- `App`
- `Header` (daemon health, uptime, active jobs)
- `RepoTable` (tracked repos, last commit/review, paused/active)
- `AgentStrip` (selected repo: janitor/hunter/inspector/scribe statuses)
- `ActivityLog` (scrollable recent journal)
- `Footer` (shortcuts)

### Data flow

- On mount: `GET /v1/daemon/status` for initial snapshot.
- Then subscribe WS `/v1/events`; reducer applies incremental updates.
- No local source of truth beyond reducer state.

### Layout

- Wide terminals: two-column (`RepoTable` + `ActivityLog`) with header/footer fixed.
- Narrow terminals: stacked sections, collapsible activity pane.
- Refresh: event-driven; no polling redraw loop.

### Keyboard

- `q`: quit dashboard only.
- `p`: toggle pause for selected repo.
- `r`: enqueue manual review for selected repo.
- `c`: open config hint panel (shows config path + restart hint).
- `j/k` or arrows: selection/navigation.
- `g/G`: jump to top/bottom of activity.

---

## 7) Config System (TOML + Zod)

### File location

- `${XDG_CONFIG_HOME:-~/.config}/opencode-janitor/config.toml`

### TOML structure

```toml
[daemon]
socketPath = "/tmp/opencode-janitor.sock"
pidFile = "/tmp/opencode-janitor.pid"
lockFile = "/tmp/opencode-janitor.lock"
logLevel = "info"

[scheduler]
globalConcurrency = 2
perRepoConcurrency = 1
agentParallelism = 2
maxAttempts = 3
retryBackoffMs = 3000

[git]
commitDebounceMs = 1200
commitPollSec = 15
prPollSec = 20
prBaseBranch = "main"
enableFsWatch = true
enableGhPr = true

[opencode]
defaultModelId = ""
hubSessionTitle = "janitor-hub"

[agents.janitor]
enabled = true
trigger = "commit"
maxFindings = 10

[agents.hunter]
enabled = true
trigger = "pr"
maxFindings = 10

[agents.inspector]
enabled = true
trigger = "manual"
maxFindings = 10

[agents.scribe]
enabled = true
trigger = "manual"
maxFindings = 10
```

### Validation and apply model

- Parse with `Bun.TOML.parse`, validate with Zod, fail-fast with line-aware errors.
- Config changes require daemon restart; no hot reload in v1.
- `config` command writes and prints: “restart daemon to apply”.

---

## 8) Extraction Plan (`plugin` -> `shared`)

### Move mostly as-is

- `schemas/finding.ts`
- `git/signal-detector.ts`
- `git/commit-detector.ts`
- `git/pr-detector.ts`
- `git/commit-resolver.ts`
- `git/pr-context-resolver.ts`
- `git/gh-pr.ts`
- `utils/review-key.ts`
- `review/prompt-builder.ts`
- `review/agent-profiles.ts` (remove plugin config coupling)

### Rewrite for daemon model

- `review/runner.ts` -> daemon `session-manager.ts` + `orchestrator.ts`
- `review/review-run-queue.ts` -> DB-backed scheduler
- `state/store.ts` -> removed, replaced by SQLite tables
- `config/schema.ts` + `config/loader.ts` -> TOML-first schema/loader
- `results/pipeline.ts` -> multi-agent findings persistence pipeline

### Import path policy

- New imports always from `@opencode-janitor/shared/*`.
- No `packages/plugin/src/*` imports allowed in CLI.
- Plugin later slimmed to thin adapter over shared primitives only.

---

## 9) Implementation Order (buildable increments)

### Phase 1: Shared foundation

- Extract schemas/types/review-key/prompt-builder into `shared`.
- Add unit tests for key parsing and schema validation.
- Build target: `shared` compiles and tests pass.

### Phase 2: Config + DB core

- Implement TOML loader/schema + SQLite connection/migrations.
- Add `add/remove/log` read/write DB paths without daemon.
- Build target: CLI can manipulate repos and query history from DB.

### Phase 3: Daemon lifecycle + IPC skeleton

- Implement lock/pid/socket startup and `/v1/health`, `/v1/daemon/status`, `/v1/daemon/stop`.
- Build target: daemon starts/stops reliably with single-instance enforcement.

### Phase 4: Repo detectors + trigger ingestion

- Wire commit/pr detector supervisors per repo.
- Persist triggers/jobs with dedupe constraints.
- Build target: commits/PR changes enqueue jobs (no agent execution yet).

### Phase 5: Scheduler + single-agent execution

- Implement scheduler and janitor agent run end-to-end with SDK session calls.
- Persist raw output + parsed findings.
- Build target: one full manual review succeeds and appears in `log`.

### Phase 6: Multi-agent orchestration

- Add hunter/inspector/scribe, per-agent statuses, partial-failure handling.
- Build target: all enabled agents run with configured trigger mapping.

### Phase 7: WebSocket stream + Ink dashboard

- Add `/v1/events`, event reducer, interactive dashboard controls.
- Build target: live TUI reflects daemon state in real time.

### Phase 8: Command hardening + production ops

- Finalize command UX, JSON output mode, exit codes.
- Add systemd/launchd unit templates and docs.
- Build target: production-ready daemon operation and observability.

### Phase 9: Recovery/chaos tests

- Crash during running jobs, restart, verify requeue/retry behavior.
- Stale pid/socket lock recovery tests.
- Build target: deterministic recovery guarantees validated.

---
