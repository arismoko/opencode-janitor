# Architecture

This project runs as a long-lived daemon with a browser dashboard.

## Components

## 1) CLI surface (`packages/cli/src/commands/*`)

The CLI is the control plane:
- manages tracked repos (`add`, `remove`)
- controls daemon lifecycle (`start`, `stop`, `status`)
- opens dashboard (`dashboard`)
- enqueues manual reviews (`review`)

## 2) Daemon runtime (`packages/cli/src/runtime/*` + `packages/cli/src/daemon/*`)

`bootstrapRuntime()` composes runtime services:
- config load + process lock
- SQLite open + migrations
- OpenCode child/session bus
- scheduler worker
- detector/repo watch loop

`runDaemon()` wires two transports on top of the same handlers:
- Unix socket HTTP server (CLI IPC)
- TCP HTTP server (browser UI + API)

## 3) Storage layer (`packages/cli/src/db/*`)

SQLite persists:
- tracked repos
- review triggers/jobs
- agent runs and findings
- event journal (including session deltas/status/error)

Dashboard reads are assembled from SQL projection queries.

## 4) Detection and scheduling

Detector (`detectors/repo-watch.ts`):
- polls for commit head movement
- polls for PR key updates
- enqueues trigger + job records

Scheduler (`scheduler/worker.ts`):
- claims queued jobs
- builds trigger context
- selects agents
- executes in bounded parallelism with retry policy

## 5) Agent execution pipeline

Per agent strategy (`reviews/strategies/*`) defines:
- `supportsTrigger`
- `prepareContext`
- prompt generation
- output parsing and finding persistence mapping

Execution writes session and lifecycle events back to the journal.

## Trigger Context Rules

## Manual

- Janitor/Hunter: workspace diff context (staged + unstaged + untracked)
- Inspector: forced repo-wide mode
- Scribe: forced repo-wide doc mode + markdown inventory metadata

## Commit

- commit subject/parents/changed files/patch for the commit SHA

## PR

- merge-base-to-head changed files + patch for PR delta

## API/Transport

Shared handler in `daemon/socket.ts` powers both transports.

Key routes:
- `GET /v1/health`
- `GET /v1/daemon/status`
- `POST /v1/daemon/stop`
- `POST /v1/reviews/enqueue`
- `GET /v1/events`
- `GET /v1/events/stream` (SSE)
- `GET /v1/dashboard/snapshot`
- `GET /v1/dashboard/report`
- `DELETE /v1/dashboard/report`

Web server (`daemon/web.ts`) also serves the dashboard HTML at `/`.

## Dashboard Frontend

Single-page UI is shipped as `packages/cli/src/daemon/dashboard.html`.

- served directly by daemon
- consumes snapshot + SSE APIs
- supports repo selection, report drill-down, activity stream, run/delete actions

Build copies dashboard asset into `packages/cli/dist/dashboard.html`.
