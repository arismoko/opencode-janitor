# opencode-janitor

Automatic structural and comprehensive code reviews inside [OpenCode](https://github.com/anomalyco/opencode). Runs silently in the background and can trigger on commits, PR updates, or both.

## What It Does

When you commit, the janitor spawns an isolated background session and reviews your diff for structural issues across three categories:

| Category | What It Catches |
|----------|----------------|
| **DRY** | Functions with >60% structural similarity, copy-pasted types, repeated constants |
| **DEAD** | Exported symbols with zero importers, unreachable branches, dead type chains |
| **STRUCTURAL** | Responsibility drift, complexity accretion, coupling increase, shotgun surgery, needless indirection |

Every finding includes a **location**, **evidence**, and an **exact prescription** (delete, extract, merge).

### Comprehensive Reviewer

The plugin also ships a second agent: **`code-reviewer`**.

- Focus: bugs, security, performance, architecture, docs drift, and spec drift
- Default trigger: PR updates
- Output contract: strict JSON findings parsed and rendered into reports
- Delivery: toast, session message, file report, and optional direct PR comment via `gh pr review`

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
    "onCommit": true,
    "debounceMs": 1200,
    "pollFallbackSec": 15
  },
  "agents": {
    "janitor": {
      "enabled": true,
      "trigger": "commit",
      "modelId": "anthropic/claude-sonnet-4-20250514",
      "variant": "high"
    },
    "reviewer": {
      "enabled": true,
      "trigger": "pr",
      "modelId": "openai/gpt-5.3-codex",
      "variant": "medium"
    }
  },
  "categories": {
    "DRY": true,
    "DEAD": true,
    "STRUCTURAL": true
  },
  "scope": {
    "include": ["**/*.{ts,tsx,js,jsx,py,go,rs,java,rb,swift,kt}"],
    "exclude": ["**/dist/**", "**/node_modules/**", "**/*.test.*"]
  },
  "model": {
    "id": "anthropic/claude-sonnet-4-20250514",
    "maxFindings": 10
  },
  "diff": {
    "maxPatchBytes": 200000,
    "maxFilesInPatch": 50,
    "maxHunksPerFile": 8
  },
  "delivery": {
    "toast": true,
    "sessionMessage": true,
    "reportFile": true,
    "reportDir": ".janitor/reports",
    "reviewer": {
      "toast": true,
      "sessionMessage": true,
      "reportFile": true,
      "reportDir": ".janitor/reviewer-reports",
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
| `model.id` | *(inherits from OpenCode)* | Fallback model for both agents if per-agent `modelId` is not set |
| `agents.janitor.modelId` | *(inherits from `model.id`)* | Override model for the janitor agent (`provider/model` format) |
| `agents.reviewer.modelId` | *(inherits from `model.id`)* | Override model for the reviewer agent (`provider/model` format) |
| `agents.*.variant` | *(none)* | Model-specific config variant (e.g. reasoning effort for OpenAI, thinking budget for Anthropic) |
| `agents.janitor.trigger` | `commit` | `commit`, `pr`, or `both` |
| `agents.reviewer.trigger` | `pr` | `commit`, `pr`, or `both` |
| `queue.dropIntermediate` | `true` | During rapid commits, only review the latest |
| `delivery.reportFile` | `true` | Writes reports to `.janitor/reports/<sha>.md` |
| `delivery.reviewer.prComment` | `true` | Post reviewer report to PR via `gh pr review` when available |
| `pr.baseBranch` | `master` | Fallback base branch when `gh` PR metadata is unavailable |

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

- Reviews run in isolated background sessions with per-agent prompts (`janitor`, `code-reviewer`)
- Janitor and reviewer run with a strict allowlist: `glob`, `grep`, `list`, `read`, `lsp` (everything else denied)
- Large diffs are truncated; the agent uses tools to explore beyond the patch
- Burst commits are coalesced: only the oldest running + latest pending are kept

### Result Delivery

Results are delivered through three sinks (all independently toggleable):

| Sink | What |
|------|------|
| **Toast** | Quick summary: "Janitor: 3 P0 findings in abc1234" |
| **Session message** | Full markdown report injected into your session |
| **File report** | Persistent `.janitor/reports/<sha>.md` |
| **PR comment** | Reviewer posts to GitHub PR via `gh pr review --comment` (optional) |

## Architecture

```
src/
  index.ts                    # Plugin entry — wires all subsystems
  types.ts                    # Shared types, category/severity constants
  config/
    schema.ts                 # Zod config schema with defaults
    loader.ts                 # XDG-compliant config loading
  git/
    signal-detector.ts        # Generic SignalDetector base (verify, debounce, inflight guard)
    commit-detector.ts        # Hybrid fs.watch + poll + accelerator
    commit-resolver.ts        # Diff extraction, parent selection
    pr-detector.ts            # PR poll + tool-hook accelerator
    pr-context-resolver.ts    # PR merge-base diff extraction
    gh-pr.ts                  # gh availability + PR metadata + PR comment delivery
    repo-locator.ts           # .git dir resolution
  review/
    base-orchestrator.ts      # Generic queue/lifecycle base class
    orchestrator.ts           # Queue, concurrency, burst coalescing
    reviewer-orchestrator.ts  # Queue/lifecycle for comprehensive reviewer
    janitor-agent.ts          # Agent definition (model, tools, prompt)
    reviewer-agent.ts         # Comprehensive reviewer agent definition
    prompt-builder.ts         # Review prompt assembly
    reviewer-prompt-builder.ts # PR review prompt assembly
    runner.ts                 # Background session spawner
  results/
    parser.ts                 # Structured finding extraction
    reviewer-parser.ts        # Reviewer JSON extraction
    formatter.ts              # Markdown report rendering
    reviewer-formatter.ts     # Reviewer markdown rendering
    format-helpers.ts         # Shared summarizeLocation/formatChangedFiles helpers
    sinks/                    # Toast, session, file delivery
  state/
    store.ts                  # Processed commit persistence
  utils/
    logger.ts                 # Structured logging
    notifier.ts               # Session message injection
    limits.ts                 # Diff truncation helpers
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
