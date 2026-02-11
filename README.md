# opencode-janitor

Automated code review daemon for local repositories, with a browser dashboard.

The architecture is now daemon-first:
- CLI commands control lifecycle and trigger reviews
- daemon runs detection, scheduling, agent execution, and persistence
- web UI is served by the daemon (`/`)
- API + SSE are exposed over both Unix socket and HTTP

## Monorepo

- `packages/cli` - daemon runtime, CLI commands, web dashboard, SQLite state
- `packages/shared` - shared schemas, trigger key parsing, prompt helpers, types

Legacy plugin package has been removed.

## Quick Start

1. Install dependencies

```bash
bun install
```

2. Ensure config exists

```bash
cd packages/cli
bun run src/index.ts config
```

3. Add a repository to track

```bash
bun run src/index.ts add /absolute/path/to/repo
```

4. Start daemon

```bash
bun run src/index.ts start
```

5. Open dashboard

```bash
bun run src/index.ts dashboard
```

## CLI Commands

- `add <repo>` - track a repository
- `remove <repoOrId>` - stop tracking a repository
- `start` / `stop` / `status` - daemon lifecycle
- `dashboard` - open browser UI (`--print-url` to print only)
- `review [repoOrId]` - enqueue manual review; defaults to current repo
- `review --agent <janitor|hunter|inspector|scribe>` - target a single agent
- `log` - read event history

## Trigger and Context Behavior

### Manual trigger

- `janitor` and `hunter`: get workspace context built from staged + unstaged changes
  - includes tracked diff (`git diff HEAD`) plus untracked file patches
  - if workspace is clean (no local changes), falls back to repo-wide analysis
- `inspector`: always repo-wide manual analysis (no diff context injected)
- `scribe`: always repo-wide documentation audit with markdown inventory
  - includes markdown file list + last git-modified date per file

### Commit trigger

- uses commit context from the detected SHA
- includes subject, parents, changed files, and commit patch

### PR trigger

- uses PR-range context (`merge-base..head`)
- includes changed files and patch for PR delta (not just single commit)

## Runtime Architecture

See `docs/ARCHITECTURE.md` for a detailed breakdown.

High-level flow:

1. Detector watches tracked repos for commit/PR activity
2. Triggers are enqueued into SQLite as review jobs
3. Scheduler claims jobs and selects eligible agents
4. Agent pipeline executes via OpenCode SDK sessions
5. Findings and session events are persisted
6. Dashboard consumes snapshots + SSE stream from daemon APIs

## Config Notes

Config is TOML and includes:

- daemon paths + web binding (`daemon.webHost`, `daemon.webPort`)
- scheduler concurrency and retry policy
- git polling behavior and PR detection toggles
- per-agent enable/trigger/maxFindings/model overrides
- OpenCode server + default model settings

Default web UI URL is `http://127.0.0.1:7700`.

## Build and Verify

From repo root:

```bash
bun run build
bun run typecheck
bun run test
```
