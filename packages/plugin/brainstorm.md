# Brainstorm: The Pivot

> What started as "opencode-janitor" has grown into a 4-agent review
> system (janitor, hunter, inspector, scribe). Time to rethink the name,
> the architecture, and the user experience.

---

## 1. Naming

The plugin is no longer just a janitor. It's a team of specialized
agents. The name should reflect that.

### Candidates

| Name                  | Vibe                              | Notes                                       |
| --------------------- | --------------------------------- | ------------------------------------------- |
| **opencode-review**   | Clean, obvious                    | Maybe too generic                           |
| **opencode-watchers** | Surveillance / always-on          | Passive feel                                |
| **opencode-patrol**   | Active, scanning                  | Law enforcement vibe                        |
| **opencode-sentries** | Guards, watchtower                | Serious tone                                |
| **opencode-squad**    | Team of agents                    | Fun, approachable                           |
| **opencode-detail**   | Police detail / special ops       | Niche, might not land                       |
| **opencode-bureau**   | Agency / organization             | Professional, cold                          |
| **opencode-bench**    | Judicial bench — agents sit in judgment | Clever but obscure                    |
| **opencode-tribunal** | Court of agents                   | Dramatic, maybe too heavy                   |
| **opencode-council**  | Deliberation, consensus           | Feels slow                                  |
| **opencode-precinct** | Detective / hunter vibes          | Fun, matches agent personas                 |
| **opencode-overwatch**| Watching everything               | Gaming connotation (Blizzard)               |
| **opencode-vigil**    | Watchful, always awake            | Poetic, clean                               |
| **opencode-audit**    | Formal review                     | Accurate but boring                         |
| **opencode-lens**     | Focused inspection                | Clean, short                                |
| **opencode-scope**    | Examining, analyzing              | Techy                                       |
| **opencode-review-board** | Formal, multi-agent panel     | Descriptive but long                        |
| **oc-crew**           | Short, team feel                  | Informal                                    |
| **opencode-ops**      | Operations team                   | Military/devops vibes                       |

### Personal Favorites (to discuss)

- **opencode-patrol** — active scanning, multiple agents patrolling
- **opencode-vigil** — poetic, "keeping vigil" over your code
- **opencode-precinct** — fun, matches the hunter/inspector personas
- **opencode-squad** — approachable, team-oriented
- **opencode-lens** — clean and minimal

---

## 2. Architecture Pivot

### Current Pain Points

1. **Session spam** — auto-triggered reviews create root-level sessions
   that clutter the user's sidebar
2. **No visibility** — background reviews are fire-and-forget, user
   can't see them running or interrupt them
3. **No centralized control** — settings are per-workspace config files,
   no dashboard or overview
4. **No multi-repo** — each workspace is isolated, no cross-repo view

### New Architecture: CLI + Service

```
┌─────────────────────────────────────────────────┐
│                    CLI (TUI)                     │
│  ┌─────────────┐ ┌──────────┐ ┌───────────────┐ │
│  │  Dashboard   │ │  Config  │ │  Repo Manager │ │
│  │  Live status │ │  Prompts │ │  Add/remove   │ │
│  │  Agent runs  │ │  Per-repo│ │  Track PRs    │ │
│  └─────────────┘ └──────────┘ └───────────────┘ │
└───────────────────────┬─────────────────────────┘
                        │ IPC / HTTP
┌───────────────────────┴─────────────────────────┐
│                   Service                        │
│  ┌──────────────────────────────────────────┐    │
│  │         Single OpenCode Session          │    │
│  │         (the "hub" session)              │    │
│  │                                          │    │
│  │  ┌────────┐ ┌────────┐ ┌─────────┐      │    │
│  │  │Janitor │ │ Hunter │ │Inspector│ ...   │    │
│  │  │child   │ │child   │ │child    │       │    │
│  │  │session │ │session │ │session  │       │    │
│  │  └────────┘ └────────┘ └─────────┘      │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │          Multi-Repo Watcher              │    │
│  │  repo-a/ ──► git poll / webhook          │    │
│  │  repo-b/ ──► git poll / webhook          │    │
│  │  repo-c/ ──► git poll / webhook          │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

### Key Architectural Decisions

#### Session Strategy
- **Hub session**: One persistent opencode session per service instance
- **Child sessions**: All agent runs (janitor, hunter, inspector, scribe)
  are children of the hub via `parentID`
- **Visibility**: Children are hidden from sidebar
  (`isRootVisibleSession` filters `!session.parentID`)
- **Subtask parts**: Can inject `subtask` parts into the hub session for
  UI-visible agent runs (shows steps/tool calls inline)
- **User's active session**: When the plugin runs inside opencode
  interactively, agent sessions are children of the user's current
  session — visible, interruptable

#### Service Mode
- opencode supports `opencode serve` (headless server)
- `session.promptAsync` returns 204 immediately, non-blocking
- Service manages the lifecycle: start → poll repos → detect changes →
  enqueue reviews → deliver results

#### CLI Modes
1. **`<name> start`** — start the background service (daemon)
2. **`<name> stop`** — stop the service
3. **`<name> status`** — show dashboard (ink-based live TUI)
4. **`<name> config`** — interactive config setup (clack prompts)
5. **`<name> add <repo>`** — track a repository
6. **`<name> remove <repo>`** — untrack a repository
7. **`<name> review <repo>`** — trigger manual review
8. **`<name> log`** — show recent review history

---

## 3. TUI / CLI Technology Stack

### Research Summary

| Library           | Purpose            | Bun OK? | Our Use                |
| ----------------- | ------------------ | ------- | ---------------------- |
| **ink**           | React for terminals| ✅      | Live dashboard         |
| **@clack/prompts**| Beautiful prompts  | ✅      | Config setup wizard    |
| **chalk**         | Colors             | ✅      | Everywhere             |
| **ora**           | Spinners           | ✅      | Loading states         |
| **boxen**         | Boxes              | ✅      | Status cards           |
| **cli-table3**    | Tables             | ✅      | Report tables          |
| **figlet**        | ASCII art          | ✅      | Banner/branding        |
| **commander**     | Arg parsing        | ✅      | CLI structure          |
| **blessed-contrib**| Dashboard widgets | ⚠️      | Charts/gauges (alt)    |

### Recommended Stack

**Layer 1 — CLI Framework:**
- `commander` for arg parsing (26k stars, rock solid, zero overhead)
- OR `@effect/cli` if we want functional + wizard mode

**Layer 2 — Interactive Config:**
- `@clack/prompts` — the gold standard for beautiful CLI prompts
  (used by Astro, SvelteKit, Hono)

**Layer 3 — Live Dashboard:**
- `ink` (React for terminals) — reactive, composable, perfect for
  live-updating agent status
- Components: `<RepoList />`, `<AgentStatus />`, `<ReviewLog />`

**Layer 4 — Polish:**
- `chalk` for colors
- `ora` for spinners
- `figlet` for the startup banner
- `boxen` for status cards

### Dashboard Mockup (rough idea)

```
╔══════════════════════════════════════════════════════╗
║  ┌─┐                                                ║
║  │▓│ O P E N C O D E   P A T R O L                  ║
║  └─┘ v1.0.0 • watching 3 repos • 4 agents active    ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  REPOS                          AGENTS               ║
║  ┌────────────────────────┐     ┌──────────────────┐ ║
║  │ ● myapp      2m ago   │     │ janitor    ✓ idle │ ║
║  │ ● api-server 5m ago   │     │ hunter     ● run  │ ║
║  │ ○ docs       paused   │     │ inspector  ✓ idle │ ║
║  └────────────────────────┘     │ scribe     ✓ idle │ ║
║                                 └──────────────────┘ ║
║                                                      ║
║  RECENT ACTIVITY                                     ║
║  ┌──────────────────────────────────────────────┐    ║
║  │ 16:42 hunter  PR #16 myapp     3 findings   │    ║
║  │ 16:38 janitor abc123 api-serv  clean ✓       │    ║
║  │ 16:35 scribe  PR #16 myapp     2 findings   │    ║
║  │ 16:30 janitor def456 myapp     1 finding     │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  [q] quit  [p] pause agent  [r] review now  [c] cfg ║
╚══════════════════════════════════════════════════════╝
```

---

## 4. Feature Ideas

### Core (MVP)

- [ ] Track multiple repos
- [ ] Auto-detect commits and PRs across all tracked repos
- [ ] Single hub session per service (all agents are children)
- [ ] Interactive config with `@clack/prompts`
- [ ] Live dashboard showing repo status + agent activity
- [ ] File reports always written (already done ✅)
- [ ] PR comments via `gh` (already done ✅)

### Settings / Config

- [ ] **Review all PRs** — in repos owned by the user (not just current branch)
- [ ] **Agent toggles** — enable/disable per agent per repo
- [ ] **Model selection** — per agent or global
- [ ] **Schedule** — review on push, on PR, on cron, manual only
- [ ] **Notification preferences** — toast, session message, file, PR comment
- [ ] **Severity threshold** — only notify on P1+, or all findings

### Nice to Have

- [ ] Webhook listener (instead of polling) for instant PR detection
- [ ] Web dashboard (via `opencode web` integration)
- [ ] Slack/Discord notifications
- [ ] Review history browser in TUI
- [ ] Agent performance stats (avg time, token usage)
- [ ] "Review all open PRs" one-shot command
- [ ] PR status checks integration (pass/fail on GitHub)
- [ ] Diff viewer in TUI for findings

---

## 5. Open Questions

1. **Name** — which one? Or something we haven't thought of yet?
2. **Monorepo or separate packages?** — CLI + plugin + shared types
3. **Service communication** — IPC (Unix socket), HTTP, or filesystem?
4. **Config format** — keep JSON? Switch to TOML? YAML?
5. **Scope of v1** — how much of this is MVP vs future?
6. **Plugin vs standalone?** — does this stay as an opencode plugin,
   become a standalone tool, or both?
7. **How to handle auth across repos?** — `gh` CLI covers GitHub,
   but what about self-hosted GitLab, etc.?

---

## 6. Migration Path

Current state → new architecture:

1. Rename package (npm, git remote, imports)
2. Extract plugin into `packages/plugin/`
3. Create `packages/cli/` with TUI
4. Create `packages/service/` with daemon
5. Shared types in `packages/shared/`
6. Keep backwards compat for existing `.janitor/` state files
   (or migrate on first run)

---

*Created: 2026-02-09*
*Status: Brainstorming*
