# opencode-janitor

Automatic code reviews inside [OpenCode](https://github.com/anomalyco/opencode). Runs silently in the background and can trigger on commits, PR updates, manual commands, or any combination.

## What It Does

The janitor plugin ships four independent review agents that watch your work and produce structured findings:

### Janitor Agent

Detects structural rot in your diffs across three domains:

| Domain | What It Catches |
|--------|----------------|
| **YAGNI** | Speculative abstractions, unused parameters, premature generalization |
| **DRY** | Functions with >60% structural similarity, copy-pasted types, repeated constants |
| **DEAD** | Exported symbols with zero importers, unreachable branches, dead type chains |

Default trigger: **commit**

### Bug Hunter Agent

Comprehensive review focused on correctness and security:

| Domain | What It Catches |
|--------|----------------|
| **BUG** | Logic errors, race conditions, incorrect assumptions, off-by-one errors |
| **SECURITY** | Injection vectors, auth bypasses, secrets exposure, unsafe deserialization |
| **CORRECTNESS** | Spec drift, contract violations, type unsoundness, invariant violations |

Default trigger: **pr**

### Inspector Agent

Detects structural complexity and design debt that impedes safe change:

| Domain | What It Catches |
|--------|----------------|
| **COMPLEXITY** | Deep nesting, high cyclomatic complexity, oversized functions/modules |
| **DESIGN** | Tight coupling, broken abstractions, layering violations, missing interfaces |
| **SMELL** | Code smells that signal deeper structural problems |

Default trigger: **manual**

### Scribe Agent

Verifies documentation stays aligned with code and identifies gaps:

| Domain | What It Catches |
|--------|----------------|
| **DRIFT** | Documentation that no longer matches the code it describes |
| **GAP** | Missing documentation for public APIs, config options, or key behaviors |
| **RELEASE** | Changelog and release note gaps for significant changes |

Default trigger: **manual**

All agents share a severity scale: **P0** (critical) → **P1** (high) → **P2** (medium) → **P3** (low).

Every finding includes a **location**, **severity**, **domain**, **evidence**, and a **prescription** (delete, extract, merge, fix).

## Install

```bash
# In your OpenCode config (opencode.json or ~/.config/opencode/config.json)
{
  "plugins": {
    "the-janitor": {
      "source": "local",
      "path": "/path/to/opencode-janitor"
    }
  }
}
```

Build the plugin:

```bash
cd opencode-janitor
bun install
bun run build
```

Restart OpenCode. You'll see a toast: **"Janitor: watchers active"**.

## Configuration

The janitor loads config from two locations (layered, later wins):

1. **User global**: `~/.config/opencode/janitor.json`
2. **Project local**: `<project>/.opencode/janitor.json`

Both are optional. All fields have defaults. Example:

```json
{
  "enabled": true,
  "autoReview": {
    "debounceMs": 1200,
    "pollFallbackSec": 15
  },
  "agents": {
    "janitor": {
      "enabled": true,
      "trigger": "commit",
      "modelId": "anthropic/claude-sonnet-4-20250514",
      "variant": "high",
      "maxFindings": 10
    },
    "hunter": {
      "enabled": true,
      "trigger": "pr",
      "modelId": "openai/gpt-5.3-codex",
      "variant": "medium",
      "maxFindings": 10
    },
    "inspector": {
      "enabled": true,
      "trigger": "manual",
      "maxFindings": 10
    },
    "scribe": {
      "enabled": true,
      "trigger": "manual",
      "maxFindings": 10
    }
  },
  "scope": {
    "include": ["**/*.{ts,tsx,js,jsx,py,go,rs,java,rb,swift,kt}"],
    "exclude": ["**/dist/**", "**/build/**", "**/node_modules/**", "**/*.test.*", "**/*.spec.*", "**/__tests__/**"]
  },
  "model": {
    "id": "anthropic/claude-sonnet-4-20250514"
  },
  "diff": {
    "maxPatchBytes": 200000,
    "maxFilesInPatch": 50,
    "maxHunksPerFile": 8
  },
  "delivery": {
    "toast": true,
    "sessionMessage": true,
    "noReply": true,
    "reportFile": true,
    "reportDir": ".janitor/reports",
    "hunter": {
      "toast": true,
      "sessionMessage": true,
      "noReply": true,
      "reportFile": true,
      "reportDir": ".janitor/hunter-reports",
      "prComment": true
    }
  },
  "pr": {
    "pollSec": 20,
    "baseBranch": "master",
    "detectToolHook": true,
    "postWithGh": true
  },
  "queue": {
    "concurrency": 1,
    "dropIntermediate": true
  }
}
```

### Key Settings

| Setting | Default | Notes |
|---------|---------|-------|
| `model.id` | *(inherits from OpenCode)* | Fallback model for all agents if per-agent `modelId` is not set |
| `agents.*.modelId` | *(inherits from `model.id`)* | Override model for a specific agent (`provider/model` format) |
| `agents.*.variant` | *(none)* | Model-specific config variant (e.g. reasoning effort for OpenAI, thinking budget for Anthropic) |
| `agents.*.maxFindings` | `10` | Maximum findings per review run (1–50) |
| `agents.janitor.trigger` | `commit` | `commit`, `pr`, `both`, `manual`, or `never` |
| `agents.hunter.trigger` | `pr` | `commit`, `pr`, `both`, `manual`, or `never` |
| `agents.inspector.trigger` | `manual` | `commit`, `pr`, `both`, `manual`, or `never` |
| `agents.scribe.trigger` | `manual` | `commit`, `pr`, `both`, `manual`, or `never` |
| `queue.dropIntermediate` | `true` | During rapid commits, only review the latest |
| `delivery.noReply` | `true` | Deliver results without triggering an assistant reply |
| `delivery.reportFile` | `true` | Writes reports to `.janitor/reports/<sha>.md` |
| `delivery.hunter.prComment` | `true` | Post hunter report to PR via `gh pr review` when available |
| `pr.baseBranch` | `master` | Fallback base branch when `gh` PR metadata is unavailable |
| `suppressions.enabled` | `true` | Enable finding suppression (auto-dismiss repeated findings) |
| `suppressions.ttlDays` | `90` | Days before suppression entries expire |
| `suppressions.maxEntries` | `200` | Maximum stored suppressions (10–500) |
| `suppressions.autoSuppressThreshold` | `0.6` | Similarity threshold for auto-suppression (0–1) |
| `history.enabled` | `true` | Enable review history tracking |
| `history.maxReviews` | `50` | Maximum stored reviews (5–200) |
| `history.trendWindow` | `10` | Number of recent reviews used for trend computation |

## How It Works

### Commit Detection

Three signal sources ensure no commits are missed:

1. **`fs.watch`** on `.git/HEAD` and `.git/refs/heads/` — catches all commits regardless of source
2. **Tool hook accelerator** — detects `git commit` commands run inside OpenCode for sub-second response
3. **Poll fallback** — every 15s, verifies HEAD hasn't changed (safety net for flaky fs.watch)

All signals are debounced and verified against HEAD before triggering a review.

### PR Detection

PR-mode reviews use a hybrid model:

1. **Tool hook accelerator** — detects `git push` and `gh pr ...` commands inside OpenCode
2. **PR poller** — periodically checks current PR head state (`gh pr view`) when `gh` is available
3. **No-`gh` fallback** — after an observed push, reviews current branch diff vs configured base branch

If `gh` is unavailable, PR comments are skipped gracefully and results still land in session/file/toast sinks.

### Review Pipeline

```
signal detected → debounce → resolve context (commit/PR) → build prompt → spawn background session → parse output → deliver results
```

- Reviews run in isolated background sessions with per-agent prompts
- All agents run with a strict tool allowlist: `glob`, `grep`, `list`, `read`, `lsp` (everything else denied)
- Large diffs are truncated; the agent uses tools to explore beyond the patch
- Burst commits are coalesced: only the oldest running + latest pending are kept

### Result Delivery

Results are delivered through three sinks (all independently toggleable):

| Sink | What |
|------|------|
| **Toast** | Quick summary: "Janitor: 3 P0 findings in abc1234" |
| **Session message** | Full markdown report injected into your session |
| **File report** | Persistent `.janitor/reports/<sha>.md` (janitor) or `.janitor/hunter-reports/<sha>.md` (hunter) |
| **PR comment** | Hunter posts to GitHub PR via `gh pr review --comment` (optional) |

## Architecture

```
src/
  index.ts                          # Plugin entry — hook wiring
  types.ts                          # Schema-derived types, severity guide, result containers
  schemas/
    finding.ts                      # Zod v4 schemas — single source of truth for domains/severities
  config/
    schema.ts                       # Zod config schema with defaults
    loader.ts                       # XDG-compliant config loading
  agents/
    registry.ts                     # Agent definition registry (config hook)
  hooks/
    command-hook.ts                 # /janitor command surface (per-agent subcommands)
    event-hook.ts                   # Session completion/error routing
    tool-hook.ts                    # Tool accelerator for commit/PR detection
  runtime/
    context.ts                      # RuntimeContext type, Exec bridge
    bootstrap.ts                    # Config, git, stores, state dir, trigger flags
    runtime-types.ts                # AgentName, AgentControl, shared runtime types
    agent-runtime.ts                # Agent queue construction with runtime specs
    agent-runtime-spec.ts           # AgentRuntimeSpec type + generic executor factory
    agent-runtime-registry.ts       # Registry of per-agent runtime specs
    detector-runtime.ts             # Commit/PR signal detector wiring
    review-runtime.ts               # Thin composition root
    session-ownership-dispatcher.ts # SessionID → owning queue O(1) routing
  review/
    review-run-queue.ts             # Generic queue with strategy pattern
    runner.ts                       # Background session spawner (spawnReview)
    prompt-builder.ts               # Unified prompt assembly
    agent-factory.ts                # Agent definition factory
    agent-profiles.ts               # Per-agent system prompts and tool configs
    strategies/
      janitor-strategy.ts           # Janitor result parsing + delivery
      hunter-strategy.ts            # Hunter result parsing + delivery + GH PR comments
      inspector-strategy.ts         # Inspector result parsing + delivery
      scribe-strategy.ts            # Scribe result parsing + delivery
  results/
    agent-output-codec.ts           # Unified JSON extraction + Zod validation
    report-renderer.ts              # Shared markdown report renderer
    format-helpers.ts               # Shared helpers (summarizeLocation, formatChangedFiles)
    formatter.ts                    # Janitor-specific report formatting
    pipeline.ts                     # Janitor result pipeline (parse → enrich → suppress)
    sinks/
      toast-sink.ts                 # Toast notification delivery
      session-sink.ts               # Session message injection
      file-sink.ts                  # File report writing
  git/
    signal-detector.ts              # Generic SignalDetector base class
    commit-detector.ts              # Hybrid fs.watch + poll + accelerator
    commit-resolver.ts              # Commit diff extraction
    pr-detector.ts                  # PR poll + tool-hook accelerator
    pr-context-resolver.ts          # PR merge-base diff extraction
    gh-pr.ts                        # gh CLI availability + PR metadata + PR comments
    repo-locator.ts                 # .git dir resolution
  state/
    store.ts                        # RuntimeStateStore — processed commits/PRs persistence
  history/
    store.ts                        # HistoryStore — review history with defensive-copy getters
    schema.ts                       # History file Zod schema
    types.ts                        # History domain types
    analyzer.ts                     # Finding analysis
    enrichment.ts                   # Finding enrichment data
    trends.ts                       # Trend computation
  findings/
    fingerprint.ts                  # Finding fingerprinting (exactKey, scopedKey)
  suppressions/
    store.ts                        # SuppressionStore
    lifecycle.ts                    # Suppression lifecycle management
    matcher.ts                      # Suppression matching
    prompt.ts                       # Suppressions block for prompt injection
    schema.ts                       # Suppression file Zod schema
    types.ts                        # Suppression domain types
  utils/
    logger.ts                       # File-based logger (no stdout/stderr)
    notifier.ts                     # Session message injection helper
    limits.ts                       # Diff truncation
    review-key.ts                   # Review key parsing (workspace:, pr: prefixes)
    atomic-write.ts                 # Atomic file writes
    eviction.ts                     # Set eviction for bounded caches
    event-log.ts                    # JSONL event logging
    state-dir.ts                    # State directory resolution
    workspace-git.ts                # Workspace git helpers
```

## Development

```bash
bun install
bun run build      # Build to dist/
bun run typecheck   # Type checking only
bun run check       # Biome lint + format
bun run dev         # Build and launch OpenCode
```

## License

MIT
