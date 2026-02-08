# The Janitor — Architecture Specification

> Automatic structural code health reviews after every commit.

## 0. Goals and Non-Goals

**Goal**: Automatically run a structural code health review after each commit, in background, with actionable P0 findings only.

**In scope**:

- DRY, DEAD, YAGNI, STRUCTURAL categories
- Diff-aware context + full repo exploration via tools
- Async background execution — never blocks the user
- Extensible module boundaries, no architectural debt

**Out of scope**:

- Bug finding, security scanning, style linting, test coverage
- Correctness issues (that's another reviewer's job)
- Performance profiling (unless dead code causes unnecessary work)

---

## 1. Commit Detection Strategy

### Decision: Hybrid Signal Model

Use **`fs.watch` on git refs** + **`tool.execute.after` accelerator** + **HEAD verification**.

### Why This Approach

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| `tool.execute.after` only | Low-latency for in-session commits | Misses commits from terminal, IDE, other tools | Incomplete |
| `experimental.hook.session_completed` | Built-in | Not commit-semantic, fires on any session end | Wrong abstraction |
| `fs.watch` only | Catches all commits regardless of source | Can drop events on some filesystems | Needs safety net |
| Polling only | Most reliable | Wasteful, adds latency | Too slow |
| **Hybrid (chosen)** | Catches everything, fast, reliable | Slightly more complex | Best trade-off |

### Signal Sources

1. **Primary — `fs.watch`**: Watch git ref files for changes:
   - `.git/HEAD`
   - `.git/refs/heads/**`
   - `.git/worktrees/**/HEAD` (if worktree)

2. **Accelerator — `tool.execute.after`**: When the `Bash` tool executes a command matching `git commit`, trigger immediate HEAD verification. Provides sub-second response for in-session commits.

3. **Safety net — periodic poll**: Every 15 seconds (configurable), run `git rev-parse HEAD`. Catches anything the watcher missed. Only active while plugin session is alive.

### Verification Rule (Single Source of Truth)

On **any** signal from any source:

```
1. Run: git rev-parse HEAD
2. If hash === lastSeenHead → ignore (no change)
3. If hash in processedSet → ignore (already reviewed)
4. Else → enqueue review job for this hash
```

This ensures exactly-once review per commit regardless of how many signals fire.

---

## 2. Module Architecture

```
opencode-janitor/
  src/
    index.ts                          # Plugin entry; wires all subsystems
    types.ts                          # Core domain types and interfaces
    config/
      schema.ts                       # Zod schema, defaults, validation
      loader.ts                       # Load from janitor.json or opencode.jsonc
    git/
      repo-locator.ts                 # Resolve .git dir, worktree paths
      commit-detector.ts              # fs.watch + signal aggregation + debounce
      commit-resolver.ts              # Commit metadata, parent selection, diff extraction
    review/
      orchestrator.ts                 # Queue, debounce, concurrency, cancellation policy
      prompt-builder.ts               # Prompt assembly with diff truncation strategy
      janitor-agent.ts                # Agent definition (model, tools, system prompt)
      runner.ts                       # Spawn background session and send prompt
    results/
      parser.ts                       # Parse agent output into structured findings
      formatter.ts                    # Render findings as markdown reports
      sinks/
        toast-sink.ts                 # TUI toast notification (summary)
        session-sink.ts               # Inject full report into parent session
        file-sink.ts                  # Write to .janitor/reports/<sha>.md
    state/
      store.ts                        # Processed commit cache, lock state
    utils/
      logger.ts                       # Structured logging
      limits.ts                       # Diff truncation helpers
  package.json
  tsconfig.json
  biome.json
  janitor-spec.md                     # This file
  README.md
```

### Module Responsibility Boundaries

| Module | Knows About | Does NOT Know About |
|--------|-------------|---------------------|
| `git/*` | Git mechanics, refs, diffs | Agents, prompts, reviews |
| `review/*` | Agent lifecycle, prompting | Git internals, output delivery |
| `results/*` | Output parsing, formatting, delivery | How reviews are run |
| `state/*` | Persistence, deduplication | Anything else |
| `config/*` | Schema, validation, defaults | Runtime behavior |
| `index.ts` | Wiring all modules together | Internal module logic |

---

## 3. Agent Design

### Decision: Single Janitor Agent

One strong reasoning model with full explorer tools. Categories overlap heavily (DRY + YAGNI, DEAD + STRUCTURAL), and a single agent provides better global prioritization to enforce "P0 only."

Future extension path: category-specific sub-agents if review quality demands it.

### Model

Default: inherit from user's OpenCode config (configurable override). The agent needs strong structural reasoning — recommend a model with good cross-file synthesis.

### Tool Permissions

```typescript
const JANITOR_TOOLS = {
  glob: true,              // Find files by pattern
  grep: true,              // Content search (ripgrep)
  Read: true,              // Read file contents
  ast_grep_search: true,   // AST-aware structural search
  // Bash: false           // Disabled by default for safety
};
```

### System Prompt Structure

The Janitor agent prompt is composed of:

1. **Role declaration**: Structural reviewer, not bug hunter
2. **Category scope**: Only enabled categories (from config)
3. **Severity policy**: P0 only — "if it's not worth fixing now, don't report it"
4. **Anti-patterns reference**: Detailed detection heuristics per category
5. **Review strategy**: Dependency graph → dead code → DRY → YAGNI → structural
6. **Commit context**: SHA, subject, changed files, diff (injected per-review)
7. **Output contract**: Strict format per finding + `NO_P0_FINDINGS` sentinel
8. **Hard cap**: Max N findings (default 10), sorted by impact

### Agent Definition

```typescript
// janitor-agent.ts
export function createJanitorAgent(config: JanitorConfig): AgentDefinition {
  return {
    name: 'janitor',
    description: 'Structural code health reviewer. Detects DRY violations, dead code, YAGNI, and structural issues.',
    config: {
      model: config.model.id,
      temperature: 0.1,  // Deterministic structural analysis
      prompt: buildSystemPrompt(config),
    },
  };
}
```

---

## 4. Diff Injection Strategy

### Data Collected Per Commit

```bash
# Commit metadata
git log -1 --format='%H%n%P%n%s' <sha>

# Changed file list with status
git diff-tree --no-commit-id --name-status -r <sha>

# Full patch (bounded)
git show --no-color --format= --patch <sha>
```

### Parent Selection

| Commit Type | Diff Strategy |
|-------------|--------------|
| Normal commit | `<sha>^1..<sha>` |
| Merge commit | First-parent diff (configurable: `first-parent` or `combined`) |
| Initial commit | Diff against empty tree (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`) |

### Large Diff Policy (Anti-Token Blowup)

Configurable limits with sensible defaults:

| Limit | Default | Purpose |
|-------|---------|---------|
| `maxPatchBytes` | 200KB | Total patch size cap |
| `maxFilesInPatch` | 50 | Max files included in diff |
| `maxHunksPerFile` | 8 | Max hunks per file |

When exceeded:

1. Include `--stat` summary + changed file list
2. Include top-churn hunks only (by lines changed)
3. Set `DIFF_TRUNCATED=true` in prompt
4. Instruct agent: "Use your tools (grep, Read, ast_grep_search) to inspect files directly for deeper evidence"

This is key: **the diff is context, not the complete source of truth**. The agent always has tools to explore further.

---

## 5. Results Delivery

### Decision: Multi-Sink Delivery (All Enabled by Default)

| Sink | What | Why |
|------|------|-----|
| **Toast** | `"Janitor: 3 P0 findings in abc1234"` | Immediate, non-intrusive |
| **Session message** | Full markdown report injected into parent session | Conversational, actionable |
| **File artifact** | `.janitor/reports/<sha>.md` + symlink `latest.md` | Durable audit trail |

Each sink is independently toggleable via config.

### Report Format

```markdown
# Janitor Report: abc1234

**Commit**: abc1234 — "feat: add user service"
**Date**: 2026-02-07T14:30:00Z
**Findings**: 3 P0 issues

---

### 1. DRY — Duplicated validation logic

**Location**: `src/services/user.ts:42`, `src/services/admin.ts:87`
**Evidence**: Both functions implement email regex validation with 78% structural similarity.
**Prescription**: Extract to `src/utils/validation.ts:validateEmail()`. Both callers import the shared helper.

### 2. DEAD — Unused export

**Location**: `src/types/legacy.ts:15` — `export type OldUserResponse`
**Evidence**: Zero importers across the codebase (grep + ast_grep confirm).
**Prescription**: Delete `OldUserResponse` type and the file if no other exports remain.

### 3. STRUCTURAL — File exceeds 300 lines

**Location**: `src/services/user.ts` (412 lines)
**Evidence**: Mixed responsibilities: validation, CRUD, and notification logic in one file.
**Prescription**: Extract notification logic to `src/services/user-notifications.ts`.
```

---

## 6. Configuration Schema

```typescript
// config/schema.ts
import { z } from 'zod';

export const JanitorConfigSchema = z.object({
  /** Master enable/disable switch */
  enabled: z.boolean().default(true),

  /** Automatic review triggers */
  autoReview: z.object({
    /** Review on every commit */
    onCommit: z.boolean().default(true),
    /** Debounce rapid commits (ms) */
    debounceMs: z.number().int().min(0).default(1200),
    /** Safety-net poll interval (seconds) */
    pollFallbackSec: z.number().int().min(5).default(15),
  }).default({}),

  /** Which categories to check */
  categories: z.object({
    DRY: z.boolean().default(true),
    DEAD: z.boolean().default(true),
    YAGNI: z.boolean().default(true),
    STRUCTURAL: z.boolean().default(true),
  }).default({}),

  /** File scope for review */
  scope: z.object({
    include: z.array(z.string()).default([
      '**/*.{ts,tsx,js,jsx,py,go,rs,java,rb,swift,kt}',
    ]),
    exclude: z.array(z.string()).default([
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/*.test.*',
      '**/*.spec.*',
      '**/__tests__/**',
    ]),
  }).default({}),

  /** Model configuration */
  model: z.object({
    /** Model identifier (provider/model format) */
    id: z.string().optional(),
    /** Max findings to report per review */
    maxFindings: z.number().int().min(1).max(50).default(10),
  }).default({}),

  /** Diff handling limits */
  diff: z.object({
    maxPatchBytes: z.number().int().min(10_000).default(200_000),
    maxFilesInPatch: z.number().int().min(1).default(50),
    maxHunksPerFile: z.number().int().min(1).default(8),
    mergeMode: z.enum(['first-parent', 'combined']).default('first-parent'),
  }).default({}),

  /** How findings are delivered */
  delivery: z.object({
    toast: z.boolean().default(true),
    sessionMessage: z.boolean().default(true),
    reportFile: z.boolean().default(true),
    reportDir: z.string().default('.janitor/reports'),
  }).default({}),

  /** Review queue behavior */
  queue: z.object({
    /** Max concurrent reviews (1 = serial, preserves ordering) */
    concurrency: z.number().int().min(1).max(3).default(1),
    /** Drop intermediate commits during rapid bursts */
    dropIntermediate: z.boolean().default(true),
  }).default({}),
});

export type JanitorConfig = z.infer<typeof JanitorConfigSchema>;
```

Config is loaded from `janitor.json` in the project root, or from an `opencode.jsonc` extension field.

---

## 7. Critical Path: Code Sketches

### A. Commit Detection + Deduplication

```typescript
// git/commit-detector.ts
import { watch, type FSWatcher } from 'node:fs';
import { log } from '../utils/logger';

export type SignalSource = 'fswatch' | 'tool-hook' | 'poll';
export type CommitSignal = { source: SignalSource; ts: number };
export type CommitCallback = (sha: string, signal: CommitSignal) => Promise<void>;

export class CommitDetector {
  private lastSeenHead: string | null = null;
  private processed = new Set<string>();
  private watchers: FSWatcher[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private getHead: () => Promise<string>,
    private onNewCommit: CommitCallback,
    private debounceMs: number = 1200,
    private pollIntervalSec: number = 15,
  ) {}

  /** Start watching for commits */
  async start(gitDir: string): Promise<void> {
    // Initialize last seen HEAD
    this.lastSeenHead = (await this.getHead()).trim();

    // Primary: fs.watch on git refs
    const targets = [`${gitDir}/HEAD`, `${gitDir}/refs/heads`];
    for (const target of targets) {
      try {
        const watcher = watch(target, { recursive: true }, () => {
          this.signal({ source: 'fswatch', ts: Date.now() });
        });
        this.watchers.push(watcher);
      } catch {
        log(`[commit-detector] could not watch ${target}`);
      }
    }

    // Safety net: periodic poll
    this.pollTimer = setInterval(() => {
      this.signal({ source: 'poll', ts: Date.now() });
    }, this.pollIntervalSec * 1000);
  }

  /** Receive accelerator signal from tool.execute.after hook */
  accelerate(): void {
    this.signal({ source: 'tool-hook', ts: Date.now() });
  }

  /** Process any signal with debounce */
  private signal(s: CommitSignal): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.verify(s), this.debounceMs);
  }

  /** Verify HEAD and trigger callback if new commit */
  private async verify(s: CommitSignal): Promise<void> {
    try {
      const head = (await this.getHead()).trim();
      if (!head || head === this.lastSeenHead) return;
      this.lastSeenHead = head;
      if (this.processed.has(head)) return;
      this.processed.add(head);
      await this.onNewCommit(head, s);
    } catch (err) {
      log(`[commit-detector] verify failed: ${err}`);
    }
  }

  /** Clean up watchers and timers */
  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}
```

### B. Prompt Builder with Truncation

```typescript
// review/prompt-builder.ts
export interface CommitContext {
  sha: string;
  subject: string;
  parents: string[];
  changedFiles: Array<{ path: string; status: string }>;
  patch: string;
  patchTruncated: boolean;
}

export interface PromptConfig {
  categories: string[];
  maxFindings: number;
  scopeInclude: string[];
  scopeExclude: string[];
}

export function buildReviewPrompt(
  commit: CommitContext,
  config: PromptConfig,
): string {
  const categoriesStr = config.categories.join(', ');
  const filesStr = commit.changedFiles
    .map((f) => `  ${f.status}\t${f.path}`)
    .join('\n');

  return `
# ROLE
You are The Janitor — a structural code health reviewer.
You do NOT look for bugs, correctness issues, or runtime failures.
You enforce structural discipline only.

# SCOPE
Active categories: ${categoriesStr}
File patterns included: ${config.scopeInclude.join(', ')}
File patterns excluded: ${config.scopeExclude.join(', ')}

# SEVERITY
ONE level: P0. If it's not worth fixing immediately, don't report it.
No "nice to have." No "consider." Every finding is a demand.
Maximum findings: ${config.maxFindings}

# ANTI-PATTERNS TO DETECT

## DRY
- Two functions with >60% structural similarity
- Repeated error-handling patterns that should be a helper
- Copy-pasted type definitions across files
- Inline constants that appear 2+ times

## DEAD
- Exported symbols with zero importers
- Type definitions referenced only by other dead types
- Conditional branches that are statically unreachable
- Parameters always passed the same value

## YAGNI
- Interfaces with exactly one implementor and no extension point
- Generic type parameters always instantiated the same way
- Abstraction layers that pass-through without transformation

## STRUCTURAL
- Files >300 lines (probably doing too much)
- Circular dependencies between modules
- Imports that cross architectural layer boundaries
- Modules with mixed responsibilities

# REVIEW STRATEGY
1. Read the diff to understand what changed
2. Use tools (grep, glob, Read, ast_grep_search) to trace references and find patterns
3. Build a mental dependency graph of affected modules
4. Find leaves with zero importers → dead code candidates
5. Find clusters with high similarity → DRY candidates
6. Find single-use abstractions → YAGNI candidates
7. Verify structural boundaries

# COMMIT CONTEXT
SHA: ${commit.sha}
Subject: ${commit.subject}
Parents: ${commit.parents.join(' ')}

Changed files:
${filesStr}

DIFF_TRUNCATED=${commit.patchTruncated}
${commit.patchTruncated ? '(Patch was truncated. Use your tools to inspect files directly for deeper evidence.)' : ''}

\`\`\`diff
${commit.patch}
\`\`\`

# OUTPUT FORMAT
For each finding, output exactly:

1. **Location**: file:line
2. **Category**: DRY | DEAD | YAGNI | STRUCTURAL
3. **Evidence**: Show the duplication, zero-reference count, etc.
4. **Prescription**: Exact action — "delete", "extract to X", "merge with Y"

No praise. No context-setting. Findings only.

If the codebase is clean: output exactly \`NO_P0_FINDINGS\`

# WHAT YOU EXPLICITLY IGNORE
- Correctness bugs
- Style preferences (formatting, naming conventions beyond drift)
- Performance (unless dead code causing unnecessary work)
- Test coverage (unless tests are testing dead code)
- Documentation quality
`.trim();
}
```

### C. Background Session Runner

```typescript
// review/runner.ts
import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';

const JANITOR_TOOLS = {
  glob: true,
  grep: true,
  Read: true,
  ast_grep_search: true,
};

export async function spawnJanitorReview(
  ctx: PluginInput,
  opts: {
    parentSessionId: string;
    prompt: string;
    config: JanitorConfig;
  },
): Promise<string> {
  // 1. Create isolated session
  const session = await ctx.client.session.create({
    body: {
      parentID: opts.parentSessionId,
      title: `Janitor Review`,
    },
    query: { directory: ctx.directory },
  });

  if (!session.data?.id) {
    throw new Error('Failed to create Janitor review session');
  }

  // 2. Build prompt body
  const body: Record<string, unknown> = {
    agent: 'janitor',
    tools: JANITOR_TOOLS,
    parts: [{ type: 'text', text: opts.prompt }],
  };

  // 3. Override model if configured
  if (opts.config.model.id) {
    const slashIdx = opts.config.model.id.indexOf('/');
    if (slashIdx > 0) {
      body.model = {
        providerID: opts.config.model.id.slice(0, slashIdx),
        modelID: opts.config.model.id.slice(slashIdx + 1),
      };
    }
  }

  // 4. Send prompt
  await ctx.client.session.prompt({
    path: { id: session.data.id },
    body,
    query: { directory: ctx.directory },
  });

  return session.data.id;
}
```

### D. Plugin Entry Point

```typescript
// index.ts
import type { Plugin } from '@opencode-ai/plugin';
import { loadConfig } from './config/loader';
import { CommitDetector } from './git/commit-detector';
import { resolveGitDir } from './git/repo-locator';
import { getCommitContext } from './git/commit-resolver';
import { ReviewOrchestrator } from './review/orchestrator';
import { buildReviewPrompt } from './review/prompt-builder';
import { createJanitorAgent } from './review/janitor-agent';
import { spawnJanitorReview } from './review/runner';
import { toastSink, sessionSink, fileSink } from './results/sinks';
import { log } from './utils/logger';

const TheJanitor: Plugin = async (ctx) => {
  const config = loadConfig(ctx.directory);
  if (!config.enabled) {
    log('[janitor] disabled by config');
    return { name: 'the-janitor' };
  }

  const gitDir = await resolveGitDir(ctx.directory, ctx.$);
  const agent = createJanitorAgent(config);

  // Track current session for result delivery
  let currentSessionId: string | undefined;

  // Orchestrator handles queuing and review lifecycle
  const orchestrator = new ReviewOrchestrator(config, async (sha) => {
    const commit = await getCommitContext(sha, config, ctx.$);
    const prompt = buildReviewPrompt(commit, {
      categories: Object.entries(config.categories)
        .filter(([, v]) => v)
        .map(([k]) => k),
      maxFindings: config.model.maxFindings,
      scopeInclude: config.scope.include,
      scopeExclude: config.scope.exclude,
    });

    if (currentSessionId) {
      return spawnJanitorReview(ctx, {
        parentSessionId: currentSessionId,
        prompt,
        config,
      });
    }
    return null;
  });

  // Commit detector
  const detector = new CommitDetector(
    async () => {
      const result = await ctx.$`git rev-parse HEAD`.text();
      return result.trim();
    },
    async (sha, signal) => {
      log(`[janitor] new commit detected: ${sha} via ${signal.source}`);
      orchestrator.enqueue(sha);
    },
    config.autoReview.debounceMs,
    config.autoReview.pollFallbackSec,
  );

  if (config.autoReview.onCommit) {
    await detector.start(gitDir);
  }

  return {
    name: 'the-janitor',

    agent: { janitor: agent },

    // Accelerator: detect git commit via tool hook
    'tool.execute.after': async (input) => {
      if (
        input.tool === 'Bash' &&
        typeof input.args?.command === 'string' &&
        /git\s+commit/.test(input.args.command)
      ) {
        detector.accelerate();
      }
    },

    // Completion detection: extract results when review session goes idle
    event: async (input) => {
      // Track current session
      if (input.event.type === 'session.created') {
        const info = (input.event as any).properties?.info;
        if (info?.id && !info?.parentID) {
          currentSessionId = info.id;
        }
      }

      // Detect review completion
      if (input.event.type === 'session.status') {
        const props = (input.event as any).properties;
        if (props?.status?.type === 'idle' && props?.sessionID) {
          await orchestrator.handleCompletion(
            props.sessionID,
            ctx,
            config,
          );
        }
      }
    },
  };
};

export default TheJanitor;
```

---

## 8. Queue and Orchestration Policy

### Concurrency

Default: **serial** (`concurrency: 1`). Reviews are deterministic and ordered.

### Burst Handling

When `dropIntermediate: true` (default):

```
Commit A arrives → starts review
Commit B arrives → queued
Commit C arrives → replaces B in queue (B dropped)
A completes → C starts
```

Only the **oldest running** + **latest pending** are kept. Middle commits are dropped because the latest commit subsumes their changes.

### Cancellation

- Running reviews are **never cancelled** (deterministic output guarantee)
- If a review is stale by >N commits when it completes, add a staleness header to the report

---

## 9. Edge Case Handling

| Scenario | Behavior |
|----------|----------|
| **Merge commits** | First-parent diff by default; `combined` mode available via config |
| **Rapid successive commits** | Debounce (1.2s default) + queue coalescing drops intermediate |
| **Initial commit** | Diff against empty tree hash (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`) |
| **Amend commits** | New HEAD hash → new review. Previous report stays archived |
| **Rebase** | Many HEAD changes; debounce + dropIntermediate prevent flood |
| **Large monorepos** | Strict include/exclude globs + diff truncation + tool-based exploration |
| **Detached HEAD** | Still processed by hash; labeled as detached in report |
| **No parent session** | Review still runs; toast delivery only (no session sink) |
| **Plugin restart mid-review** | Processed set is in-memory; review may re-trigger. Idempotent by design |

---

## 10. Extension Points (Future)

These are **not built in v1** but the architecture accommodates them without refactoring:

1. **Category-specific sub-agents**: Replace single agent with parallel specialists
2. **Trend analytics**: Track finding counts over time in `.janitor/trends.json`
3. **SARIF export**: Add a SARIF sink for CI/CD integration
4. **Custom categories**: User-defined anti-patterns via config
5. **PR review mode**: Review entire PR diff instead of single commits
6. **Ignore directives**: `// janitor-ignore DRY` inline comments
7. **Baseline support**: Mark existing findings as accepted, only report new ones

---

## 11. Package Manifest

```json
{
  "name": "opencode-janitor",
  "version": "0.1.0",
  "description": "Automatic structural code health reviews for OpenCode",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "license": "MIT",
  "keywords": [
    "opencode",
    "opencode-plugin",
    "code-review",
    "code-health",
    "janitor",
    "dead-code",
    "dry",
    "yagni"
  ],
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target bun --format esm && tsc --emitDeclarationOnly",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "lint": "biome lint .",
    "format": "biome format . --write",
    "check": "biome check --write .",
    "check:ci": "biome check .",
    "dev": "bun run build && opencode"
  },
  "dependencies": {
    "@opencode-ai/plugin": "^1.1.19",
    "@opencode-ai/sdk": "^1.1.19",
    "zod": "^4.1.8"
  },
  "devDependencies": {
    "@biomejs/biome": "2.3.11",
    "bun-types": "latest",
    "typescript": "^5.7.3"
  }
}
```

---

## 12. v1.0 Defaults Summary

| Setting | Default |
|---------|---------|
| Enabled | `true` |
| Auto-review on commit | `true` |
| Debounce | 1200ms |
| Poll fallback | 15s |
| Categories | All 4 (DRY, DEAD, YAGNI, STRUCTURAL) |
| Max findings | 10 |
| Diff max patch size | 200KB |
| Diff max files | 50 |
| Merge mode | first-parent |
| Delivery: toast | `true` |
| Delivery: session message | `true` |
| Delivery: file report | `true` |
| Queue concurrency | 1 (serial) |
| Drop intermediate commits | `true` |
