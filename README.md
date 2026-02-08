# opencode-janitor

Automatic structural code health reviews after every commit. Runs silently in the background inside [OpenCode](https://github.com/anomalyco/opencode), surfacing only P0-class issues that are worth fixing right now.

## What It Does

When you commit, the janitor spawns an isolated background session and reviews your diff for structural issues across four categories:

| Category | What It Catches |
|----------|----------------|
| **DRY** | Functions with >60% structural similarity, copy-pasted types, repeated constants |
| **DEAD** | Exported symbols with zero importers, unreachable branches, dead type chains |
| **YAGNI** | Single-implementor interfaces, always-same generics, pass-through abstractions |
| **STRUCTURAL** | Files >300 lines, circular dependencies, layer boundary violations |

Every finding includes a **location**, **evidence**, and an **exact prescription** (delete, extract, merge). If the codebase is clean, you get a toast and nothing else.

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

Restart OpenCode. You'll see a toast: **"Janitor: watching for commits"**.

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
  "categories": {
    "DRY": true,
    "DEAD": true,
    "YAGNI": true,
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
    "reportDir": ".janitor/reports"
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
| `model.id` | *(inherits from OpenCode)* | Override with `provider/model` format |
| `autoReview.onCommit` | `true` | Set `false` to disable automatic reviews |
| `queue.dropIntermediate` | `true` | During rapid commits, only review the latest |
| `delivery.reportFile` | `true` | Writes reports to `.janitor/reports/<sha>.md` |

## How It Works

### Commit Detection

Three signal sources ensure no commits are missed:

1. **`fs.watch`** on `.git/HEAD` and `.git/refs/heads/` — catches all commits regardless of source
2. **Tool hook accelerator** — detects `git commit` commands run inside OpenCode for sub-second response
3. **Poll fallback** — every 15s, verifies HEAD hasn't changed (safety net for flaky fs.watch)

All signals are debounced and verified against HEAD before triggering a review.

### Review Pipeline

```
commit detected → debounce → verify HEAD → extract diff → build prompt → spawn background session → parse output → deliver results
```

- Reviews run in isolated background sessions with their own agent (`janitor`)
- The janitor agent gets `glob`, `grep`, `Read`, and `ast_grep_search` tools — no write access
- Large diffs are truncated; the agent uses tools to explore beyond the patch
- Burst commits are coalesced: only the oldest running + latest pending are kept

### Result Delivery

Results are delivered through three sinks (all independently toggleable):

| Sink | What |
|------|------|
| **Toast** | Quick summary: "Janitor: 3 P0 findings in abc1234" |
| **Session message** | Full markdown report injected into your session |
| **File report** | Persistent `.janitor/reports/<sha>.md` |

## Architecture

```
src/
  index.ts                    # Plugin entry — wires all subsystems
  config/
    schema.ts                 # Zod config schema with defaults
    loader.ts                 # XDG-compliant config loading
  git/
    commit-detector.ts        # Hybrid fs.watch + poll + accelerator
    commit-resolver.ts        # Diff extraction, parent selection
    repo-locator.ts           # .git dir resolution
  review/
    orchestrator.ts           # Queue, concurrency, burst coalescing
    janitor-agent.ts          # Agent definition (model, tools, prompt)
    prompt-builder.ts         # Review prompt assembly
    runner.ts                 # Background session spawner
  results/
    parser.ts                 # Structured finding extraction
    formatter.ts              # Markdown report rendering
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
