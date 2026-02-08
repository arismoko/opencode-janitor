# The Janitor — Memory System Specification

> Suppression memory and review history for persistent, context-aware reviews.

## 2026-02 Addendum: Memory Scope

Memory in this spec is scoped to the structural janitor pipeline. The new
`code-reviewer` PR pipeline intentionally does not share janitor suppressions or
history ledgers, to avoid cross-agent semantic contamination.

If reviewer memory is added later, it must use separate stores and fingerprints
under its own namespace.

This spec covers two complementary systems that give the janitor memory across reviews:

1. **Suppression Memory** — user-controlled "I know, leave it alone" for intentionally accepted findings
2. **Review History** — automated finding lifecycle tracking for regression detection and trend analysis

Both share a common fingerprinting algorithm but serve different purposes and have different trust boundaries.

---

## Part 1: Suppression Memory

### 1.1 Problem

The janitor re-reports the same findings every commit. If a developer intentionally accepts a DRY violation (e.g., two similar functions that will diverge), the janitor nags forever. There's no way to say "I know, this is intentional."

### 1.2 Design Principles

- **User-controlled**: Only the user creates suppressions. The system never auto-suppresses.
- **Prompt-injected**: Active suppressions are injected into the janitor's system prompt as a compact block so the LLM can skip known-accepted findings.
- **Deterministic post-processing**: Even if the LLM ignores the prompt hint and re-reports a suppressed finding, the post-processing pipeline filters it out before delivery. Prompt injection is best-effort assist; matching is the safety net.
- **Bounded**: Hard cap on entries, TTL-based expiry, oldest-unseen eviction.
- **Rename-tolerant**: Two-key fingerprinting strategy handles file renames gracefully.

### 1.3 Storage

File: `.janitor/suppressions.json`

```typescript
// src/suppressions/types.ts

export interface Suppression {
  /** High-precision key: category + suffix2 + codeShapeHash + evidenceHash */
  exactKey: string;
  /** Rename-tolerant key: category + codeShapeHash (no path component) */
  scopedKey: string;
  /** Which tier was used to create this */
  tier: 'exact' | 'scoped';
  /** Human-readable reason (optional, from user) */
  reason?: string;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when last seen (matched against a finding) */
  lastSeenAt: string;
  /** TTL in days — auto-expires after this many days without being seen */
  ttlDays: number;
  /** If true, underlying code changed significantly — needs user revalidation */
  needsRevalidation: boolean;
  /** Original finding data for display purposes */
  original: {
    category: string;
    location: string;
    evidence: string;
    prescription: string;
    sha: string;
  };
}

export interface SuppressionsFile {
  version: 1;
  suppressions: Suppression[];
}
```

### 1.4 Fingerprinting Algorithm

Shared with review history (§2.4). Lives in `src/findings/fingerprint.ts`.

A finding produces two keys:

#### exactKey (high precision)

```
exactKey = category + "|" + suffix2(location) + "|" + codeShapeHash(evidence) + "|" + evidenceHash(evidence)
```

- `suffix2(location)`: Last 2 path segments of the file path (e.g., `src/utils/helper.ts:42` → `utils/helper.ts:42`). Tolerates project root renames but not internal restructuring.
- `codeShapeHash(evidence)`: Normalize the evidence text (strip whitespace, lowercase, remove literals/numbers), then hash. Captures structural shape regardless of variable names.
- `evidenceHash(evidence)`: Direct hash of trimmed evidence text. Disambiguates structurally similar findings.

#### scopedKey (rename-tolerant)

```
scopedKey = category + "|" + codeShapeHash(evidence)
```

No path component at all. Matches the same structural pattern anywhere in the codebase. Higher false-positive risk — used when the user explicitly opts into broad matching.

#### Hash function

Use FNV-1a 32-bit (fast, no crypto dependency, good distribution for short strings). Output as 8-char hex.

```typescript
// src/findings/fingerprint.ts

export interface FindingFingerprint {
  exactKey: string;
  scopedKey: string;
}

export function fingerprint(finding: {
  category: string;
  location: string;
  evidence: string;
}): FindingFingerprint {
  const suffix = suffix2(finding.location);
  const shape = codeShapeHash(finding.evidence);
  const evidence = fnv1a(finding.evidence.trim());

  return {
    exactKey: `${finding.category}|${suffix}|${shape}|${evidence}`,
    scopedKey: `${finding.category}|${shape}`,
  };
}

/** Last 2 path segments + line number */
function suffix2(location: string): string {
  const [filePath, ...rest] = location.split(':');
  const segments = filePath.split('/');
  const suffix = segments.slice(-2).join('/');
  return rest.length > 0 ? `${suffix}:${rest.join(':')}` : suffix;
}

/** Normalize evidence to structural shape, then hash */
function codeShapeHash(evidence: string): string {
  const normalized = evidence
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')           // collapse whitespace
    .replace(/\d+/g, 'N')           // normalize numbers
    .replace(/"[^"]*"/g, '"S"')     // normalize string literals
    .replace(/'[^']*'/g, "'S'")     // normalize single-quoted strings
    .replace(/`[^`]*`/g, '`S`');    // normalize template literals
  return fnv1a(normalized);
}

/** FNV-1a 32-bit hash → 8-char hex */
function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
```

### 1.5 Matching Strategy

When a new finding arrives, the matcher checks against all active suppressions:

```typescript
// src/suppressions/matcher.ts

export type MatchResult =
  | { matched: false }
  | { matched: true; suppression: Suppression; tier: 'exact' | 'scoped' };

export function matchSuppression(
  finding: Finding,
  suppressions: Suppression[],
): MatchResult {
  const fp = fingerprint(finding);

  // 1. Try exact match first (high confidence)
  const exact = suppressions.find(
    (s) => s.exactKey === fp.exactKey && !isExpired(s),
  );
  if (exact) {
    return { matched: true, suppression: exact, tier: 'exact' };
  }

  // 2. Fall back to scoped match (rename-tolerant)
  const scoped = suppressions.find(
    (s) =>
      s.tier === 'scoped' &&
      s.scopedKey === fp.scopedKey &&
      !isExpired(s),
  );
  if (scoped) {
    return { matched: true, suppression: scoped, tier: 'scoped' };
  }

  return { matched: false };
}
```

### 1.6 Prompt Injection

Active suppressions are injected into the janitor's system prompt as a compact block. This is a **best-effort hint** — the LLM may still report suppressed findings, and the post-processing matcher filters them out.

Budget: **1.5KB max** for the suppressions block. If suppressions exceed this, include only the most recently seen ones.

Format:

```
[SUPPRESSIONS_V1]
DRY|utils/helper.ts:42|a1b2c3d4|reason: intentional divergence
DEAD|types/legacy.ts:15|e5f6a7b8|reason: kept for migration
[/SUPPRESSIONS_V1]
```

Each row is pipe-delimited: `category|suffix2|shapeHash|reason`. Compact enough for the LLM to pattern-match against its findings before reporting.

```typescript
// src/suppressions/prompt.ts

const MAX_PROMPT_BYTES = 1536; // 1.5KB budget

export function buildSuppressionsBlock(
  suppressions: Suppression[],
): string {
  // Sort by lastSeenAt descending (most relevant first)
  const sorted = [...suppressions]
    .filter((s) => !isExpired(s) && !s.needsRevalidation)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  const lines: string[] = [];
  let bytes = '[SUPPRESSIONS_V1]\n[/SUPPRESSIONS_V1]'.length;

  for (const s of sorted) {
    const suffix = s.exactKey.split('|')[1];
    const shape = s.exactKey.split('|')[2];
    const reason = s.reason ? `|reason: ${s.reason}` : '';
    const line = `${s.original.category}|${suffix}|${shape}${reason}`;

    if (bytes + line.length + 1 > MAX_PROMPT_BYTES) break;
    lines.push(line);
    bytes += line.length + 1;
  }

  if (lines.length === 0) return '';

  return [
    '[SUPPRESSIONS_V1]',
    ...lines,
    '[/SUPPRESSIONS_V1]',
  ].join('\n');
}
```

### 1.7 Lifecycle

#### Creation

User runs: `janitor suppress --sha <sha> --finding <number>`

This is a future CLI/command integration. For MVP, suppressions can also be created by editing `.janitor/suppressions.json` directly.

```typescript
// src/suppressions/lifecycle.ts

export function createSuppression(
  finding: Finding,
  sha: string,
  opts: { tier?: 'exact' | 'scoped'; reason?: string; ttlDays?: number },
): Suppression {
  const fp = fingerprint(finding);
  const now = new Date().toISOString();

  return {
    exactKey: fp.exactKey,
    scopedKey: fp.scopedKey,
    tier: opts.tier ?? 'exact',
    reason: opts.reason,
    createdAt: now,
    lastSeenAt: now,
    ttlDays: opts.ttlDays ?? 90,
    needsRevalidation: false,
    original: {
      category: finding.category,
      location: finding.location,
      evidence: finding.evidence,
      prescription: finding.prescription,
      sha,
    },
  };
}
```

#### Touch (on match)

When a finding matches a suppression, `lastSeenAt` is updated. This resets the TTL countdown.

#### Expiry

A suppression expires when `now - lastSeenAt > ttlDays`. Expired suppressions are:
- Excluded from prompt injection
- Excluded from matching
- Kept in the file until the next lifecycle GC pass (which removes them)

#### Revalidation

When the file referenced by a suppression has changed significantly (churn ≥ 0.60 of lines changed relative to the file at suppression time), mark `needsRevalidation: true`. Revalidation-flagged suppressions:
- Are still matched (to avoid re-reporting)
- Are NOT injected into the prompt
- Appear in reports with a warning: "⚠️ Suppressed finding may need revalidation — underlying code changed significantly"

Churn detection runs during post-processing, not in real-time. Uses `git diff --stat` between the suppression's original SHA and the current commit.

### 1.8 Bounds

| Limit | Default | Purpose |
|-------|---------|---------|
| Max entries | 200 | Hard cap on suppressions |
| TTL | 90 days | Auto-expire unseen suppressions |
| Prompt budget | 1.5KB | Keep system prompt lean |
| Eviction strategy | Oldest unseen first | Remove least relevant |

When the 200-entry cap is hit, evict the suppression with the oldest `lastSeenAt` that is not currently matching any finding.

### 1.9 Config Additions

```typescript
// Added to JanitorConfigSchema
suppressions: z.object({
  /** Enable suppression memory */
  enabled: z.boolean().default(true),
  /** Default TTL in days for new suppressions */
  ttlDays: z.number().int().min(1).default(90),
  /** Max suppressions to store */
  maxEntries: z.number().int().min(10).max(500).default(200),
  /** Max bytes for prompt injection block */
  maxPromptBytes: z.number().int().min(256).max(4096).default(1536),
  /** File churn threshold for revalidation (0.0–1.0) */
  revalidationChurn: z.number().min(0).max(1).default(0.60),
}).default({}),
```

### 1.10 Module Map

```
src/
  findings/
    fingerprint.ts          # Shared: suffix2, codeShapeHash, fnv1a, fingerprint()
  suppressions/
    types.ts                # Suppression, SuppressionsFile interfaces
    schema.ts               # Zod schema for suppressions.json validation
    store.ts                # Load/save/evict .janitor/suppressions.json
    matcher.ts              # matchSuppression() — exact then scoped
    lifecycle.ts            # create, touch, expire, revalidate
    prompt.ts               # buildSuppressionsBlock() for system prompt
    index.ts                # Re-exports, convenience wrappers
```

### 1.11 Integration Points

1. **`prompt-builder.ts`**: Call `buildSuppressionsBlock()` and append to system prompt
2. **Post-processing (new pipeline step)**: After `parser.ts` extracts findings, run each through `matchSuppression()`. Matched findings are removed from the result before delivery.
3. **Delivery enrichment**: Suppressed count noted in toast: `"Janitor: 3 P0 in a1b2c3d (1 suppressed)"`
4. **`store.ts` (suppressions)**: Loaded on plugin init, saved after each review's post-processing pass

---

## Part 2: Review History

### 2.1 Problem

The janitor treats every review as independent. It can't tell you:
- "This DRY violation has been reported 5 times and never fixed"
- "The dead code in legacy.ts was fixed in commit X but regressed in commit Y"
- "Structural health is trending worse — 3 findings/review average, up from 1"

### 2.2 Design Principles

- **Post-processing only**: Review history is NEVER injected into the prompt. It enriches delivery outputs only.
- **Deterministic**: Finding lifecycle transitions (new → persistent → resolved → regressed) are computed by fingerprint matching against a ledger, not LLM judgment.
- **Bounded**: Fixed review count cap + byte size cap. Oldest reviews evicted first.
- **Ledger rebuilt from source**: The active finding ledger is recomputed from retained reviews on every write, preventing drift between reviews and ledger.

### 2.3 Storage

File: `.janitor/history.json`

```typescript
// src/history/types.ts

/** Lifecycle state of a finding across reviews */
export type FindingLifecycle = 'new' | 'persistent' | 'resolved' | 'regressed';

/** A finding with lifecycle annotation */
export interface AnnotatedFinding {
  /** The original finding */
  finding: Finding;
  /** Fingerprint keys */
  exactKey: string;
  scopedKey: string;
  /** Lifecycle state relative to previous review */
  lifecycle: FindingLifecycle;
  /** How many consecutive reviews this finding has appeared in */
  streak: number;
}

/** A stored review record */
export interface ReviewRecord {
  sha: string;
  subject: string;
  date: string; // ISO
  /** Fingerprinted findings from this review */
  findings: Array<{
    exactKey: string;
    scopedKey: string;
    category: string;
    location: string;
  }>;
  /** Total finding count */
  findingCount: number;
  /** Was the review clean? */
  clean: boolean;
}

/** The active finding ledger — derived, not stored independently */
export interface FindingLedgerEntry {
  exactKey: string;
  scopedKey: string;
  category: string;
  location: string;
  /** First SHA where this finding appeared */
  firstSeenSha: string;
  /** Most recent SHA where this finding appeared */
  lastSeenSha: string;
  /** Total reviews where this finding appeared */
  occurrences: number;
  /** Current state */
  state: 'active' | 'resolved';
}

/** The history file structure */
export interface HistoryFile {
  version: 1;
  reviews: ReviewRecord[];
}
```

### 2.4 Fingerprinting

Same algorithm as suppressions (§1.4). Both systems import from `src/findings/fingerprint.ts`.

### 2.5 Lifecycle Transitions

After each review, findings are matched against the ledger (built from all retained reviews):

| Previous State | Current Review | → New State |
|---------------|----------------|-------------|
| Not in ledger | Finding present | `new` |
| `active` | Finding present | `persistent` |
| `active` | Finding absent | `resolved` |
| `resolved` | Finding present | `regressed` |
| `resolved` | Finding absent | (stays resolved, eventually evicted) |

```typescript
// src/history/analyzer.ts

export function analyzeLifecycle(
  currentFindings: Finding[],
  ledger: FindingLedgerEntry[],
): AnnotatedFinding[] {
  const ledgerByExact = new Map(ledger.map((e) => [e.exactKey, e]));
  const ledgerByScoped = new Map(ledger.map((e) => [e.scopedKey, e]));

  return currentFindings.map((finding) => {
    const fp = fingerprint(finding);

    // Try exact match first, then scoped
    const entry = ledgerByExact.get(fp.exactKey)
      ?? ledgerByScoped.get(fp.scopedKey);

    let lifecycle: FindingLifecycle;
    let streak: number;

    if (!entry) {
      lifecycle = 'new';
      streak = 1;
    } else if (entry.state === 'resolved') {
      lifecycle = 'regressed';
      streak = 1;
    } else {
      lifecycle = 'persistent';
      streak = entry.occurrences + 1;
    }

    return {
      finding,
      exactKey: fp.exactKey,
      scopedKey: fp.scopedKey,
      lifecycle,
      streak,
    };
  });
}
```

#### Resolved detection

When the current review has fewer findings than the ledger's active entries, the missing entries are marked `resolved`. This is computed separately:

```typescript
export function detectResolved(
  currentFingerprints: Set<string>,
  ledger: FindingLedgerEntry[],
): FindingLedgerEntry[] {
  return ledger.filter(
    (entry) =>
      entry.state === 'active' &&
      !currentFingerprints.has(entry.exactKey),
  );
}
```

### 2.6 Ledger Rebuild

The ledger is NOT stored separately — it's recomputed from `reviews[]` on every history write. This prevents drift.

```typescript
// src/history/store.ts (partial)

function rebuildLedger(reviews: ReviewRecord[]): FindingLedgerEntry[] {
  const ledger = new Map<string, FindingLedgerEntry>();

  // Process reviews in chronological order
  const sorted = [...reviews].sort(
    (a, b) => a.date.localeCompare(b.date),
  );

  for (const review of sorted) {
    const seenInReview = new Set<string>();

    for (const f of review.findings) {
      seenInReview.add(f.exactKey);

      const existing = ledger.get(f.exactKey);
      if (existing) {
        existing.lastSeenSha = review.sha;
        existing.occurrences += 1;
        existing.state = 'active';
        existing.location = f.location; // update to latest location
      } else {
        ledger.set(f.exactKey, {
          exactKey: f.exactKey,
          scopedKey: f.scopedKey,
          category: f.category,
          location: f.location,
          firstSeenSha: review.sha,
          lastSeenSha: review.sha,
          occurrences: 1,
          state: 'active',
        });
      }
    }

    // Mark findings not seen in this review as resolved
    for (const [key, entry] of ledger) {
      if (entry.state === 'active' && !seenInReview.has(key)) {
        entry.state = 'resolved';
      }
    }
  }

  return [...ledger.values()];
}
```

### 2.7 Trend Aggregation

```typescript
// src/history/trends.ts

export interface TrendData {
  /** Number of reviews in the window */
  reviewCount: number;
  /** Average findings per review */
  avgFindings: number;
  /** Findings by category over the window */
  byCategory: Record<string, {
    total: number;
    avg: number;
    trend: 'improving' | 'stable' | 'worsening';
  }>;
  /** Overall trend direction */
  overallTrend: 'improving' | 'stable' | 'worsening';
}

export function computeTrends(
  reviews: ReviewRecord[],
  windowSize: number = 10,
): TrendData {
  const window = reviews.slice(-windowSize);
  if (window.length < 2) {
    return {
      reviewCount: window.length,
      avgFindings: window[0]?.findingCount ?? 0,
      byCategory: {},
      overallTrend: 'stable',
    };
  }

  const midpoint = Math.floor(window.length / 2);
  const firstHalf = window.slice(0, midpoint);
  const secondHalf = window.slice(midpoint);

  const avgFirst = average(firstHalf.map((r) => r.findingCount));
  const avgSecond = average(secondHalf.map((r) => r.findingCount));

  // Category breakdown
  const byCategory: TrendData['byCategory'] = {};
  const categories = new Set(
    window.flatMap((r) => r.findings.map((f) => f.category)),
  );

  for (const cat of categories) {
    const catFirstAvg = average(
      firstHalf.map((r) =>
        r.findings.filter((f) => f.category === cat).length,
      ),
    );
    const catSecondAvg = average(
      secondHalf.map((r) =>
        r.findings.filter((f) => f.category === cat).length,
      ),
    );

    byCategory[cat] = {
      total: window.reduce(
        (sum, r) =>
          sum + r.findings.filter((f) => f.category === cat).length,
        0,
      ),
      avg: catSecondAvg,
      trend: trendDirection(catFirstAvg, catSecondAvg),
    };
  }

  return {
    reviewCount: window.length,
    avgFindings: avgSecond,
    byCategory,
    overallTrend: trendDirection(avgFirst, avgSecond),
  };
}

function average(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

function trendDirection(
  before: number,
  after: number,
): 'improving' | 'stable' | 'worsening' {
  const delta = after - before;
  const threshold = 0.5; // half a finding per review
  if (delta < -threshold) return 'improving';
  if (delta > threshold) return 'worsening';
  return 'stable';
}
```

### 2.8 Delivery Enrichment

History data enriches all three delivery sinks. This is a post-processing step that runs AFTER lifecycle analysis and BEFORE sink delivery.

#### Toast enrichment

```
// Before history:
"Janitor: 4 P0 in a1b2c3d"

// After history:
"Janitor: 4 P0 in a1b2c3d (1 new, 2 persistent, 1 regressed)"
```

#### Session message enrichment

A "History Signals" section appended to the markdown report:

```markdown
---

## History Signals

| Metric | Value |
|--------|-------|
| New findings | 1 |
| Persistent (seen before) | 2 |
| Regressed (were fixed) | 1 |
| Resolved since last review | 3 |
| Overall trend (last 10) | ↗ worsening |
| Avg findings/review | 2.4 |

### Persistent Findings (fix these!)

- **DRY** in `utils/helper.ts:42` — seen in 5 consecutive reviews
- **DEAD** in `types/legacy.ts:15` — seen in 3 consecutive reviews

### Regressions

- **STRUCTURAL** in `services/user.ts` — was resolved in `c3d4e5f`, regressed in `a1b2c3d`
```

#### File report enrichment

Same as session message — the history section is appended to the `.janitor/reports/<sha>.md` file.

```typescript
// src/history/enrichment.ts

export interface EnrichmentData {
  annotatedFindings: AnnotatedFinding[];
  resolved: FindingLedgerEntry[];
  trends: TrendData;
}

export function enrichToastMessage(
  baseMessage: string,
  data: EnrichmentData,
): string {
  const counts = countByLifecycle(data.annotatedFindings);
  const parts: string[] = [];

  if (counts.new > 0) parts.push(`${counts.new} new`);
  if (counts.persistent > 0) parts.push(`${counts.persistent} persistent`);
  if (counts.regressed > 0) parts.push(`${counts.regressed} regressed`);

  if (parts.length === 0) return baseMessage;
  return `${baseMessage} (${parts.join(', ')})`;
}

export function buildHistorySection(data: EnrichmentData): string {
  // ... renders the markdown section shown above
}
```

### 2.9 Bounds

| Limit | Default | Purpose |
|-------|---------|---------|
| Max reviews | 50 | History window cap |
| Max file size | 2MB | Prevent unbounded disk growth |
| Trend window | 10 reviews | Recent trend analysis |
| Eviction strategy | Oldest first | Simple FIFO |

When limits are hit:
1. Check byte size first — if over 2MB, evict oldest reviews until under
2. Check review count — if over 50, evict oldest
3. Rebuild ledger from remaining reviews

### 2.10 Config Additions

```typescript
// Added to JanitorConfigSchema
history: z.object({
  /** Enable review history tracking */
  enabled: z.boolean().default(true),
  /** Max reviews to retain */
  maxReviews: z.number().int().min(5).max(200).default(50),
  /** Max file size in bytes */
  maxBytes: z.number().int().min(100_000).default(2_097_152), // 2MB
  /** Trend analysis window size */
  trendWindow: z.number().int().min(2).max(50).default(10),
}).default({}),
```

### 2.11 Module Map

```
src/
  findings/
    fingerprint.ts          # SHARED: fingerprint(), suffix2, codeShapeHash, fnv1a
  history/
    types.ts                # ReviewRecord, FindingLedgerEntry, AnnotatedFinding, etc.
    schema.ts               # Zod schema for history.json validation
    store.ts                # Load/save/evict .janitor/history.json + rebuildLedger()
    analyzer.ts             # analyzeLifecycle(), detectResolved()
    trends.ts               # computeTrends()
    enrichment.ts           # enrichToastMessage(), buildHistorySection()
    index.ts                # Re-exports, convenience wrappers
```

### 2.12 Integration Points

1. **Post-processing pipeline**: After parser extracts findings → fingerprint all → analyze lifecycle against ledger → enrich delivery outputs
2. **`formatter.ts`**: Extended to accept optional `EnrichmentData` and append history section
3. **Toast sink**: Uses `enrichToastMessage()` to annotate summary
4. **Session sink**: Appends `buildHistorySection()` to report
5. **File sink**: Same as session sink
6. **History store**: `addReview()` called after each successful review, triggers ledger rebuild

---

## Part 3: Shared Infrastructure

### 3.1 Fingerprint Module

`src/findings/fingerprint.ts` is the shared foundation. Both suppressions and history import from it. It has zero internal dependencies (leaf module).

Exports:
- `fingerprint(finding)` → `{ exactKey, scopedKey }`
- `suffix2(location)` → last 2 path segments
- `codeShapeHash(evidence)` → normalized structural hash
- `fnv1a(str)` → 32-bit hash as 8-char hex

### 3.2 Post-Processing Pipeline

Currently the flow is:

```
LLM output → parser.ts → findings[] → sinks (toast, session, file)
```

With memory, it becomes:

```
LLM output → parser.ts → findings[]
  → fingerprint all findings
  → suppression matcher (filter out suppressed)
  → history analyzer (annotate lifecycle)
  → enrichment (add history signals to delivery)
  → sinks (toast, session, file)
```

This pipeline should live in a new orchestration point, e.g., `src/results/pipeline.ts`:

```typescript
// src/results/pipeline.ts

export async function processReviewOutput(
  raw: string,
  sha: string,
  deps: {
    suppressionStore: SuppressionStore;
    historyStore: HistoryStore;
    config: JanitorConfig;
  },
): Promise<{
  result: ReviewResult;
  enrichment?: EnrichmentData;
  suppressedCount: number;
}> {
  // 1. Parse
  const result = parseReviewOutput(raw, sha);
  if (result.clean) return { result, suppressedCount: 0 };

  // 2. Suppress
  let suppressedCount = 0;
  if (deps.config.suppressions.enabled) {
    const filtered: Finding[] = [];
    for (const finding of result.findings) {
      const match = matchSuppression(finding, deps.suppressionStore.getActive());
      if (match.matched) {
        deps.suppressionStore.touch(match.suppression);
        suppressedCount++;
      } else {
        filtered.push(finding);
      }
    }
    result.findings = filtered;
    result.clean = filtered.length === 0;
  }

  // 3. History
  let enrichment: EnrichmentData | undefined;
  if (deps.config.history.enabled) {
    const ledger = deps.historyStore.getLedger();
    const annotated = analyzeLifecycle(result.findings, ledger);
    const resolved = detectResolved(
      new Set(annotated.map((a) => a.exactKey)),
      ledger,
    );
    const trends = computeTrends(
      deps.historyStore.getReviews(),
      deps.config.history.trendWindow,
    );

    enrichment = { annotatedFindings: annotated, resolved, trends };

    // Record this review
    deps.historyStore.addReview({
      sha,
      subject: result.subject,
      date: new Date().toISOString(),
      findings: annotated.map((a) => ({
        exactKey: a.exactKey,
        scopedKey: a.scopedKey,
        category: a.finding.category,
        location: a.finding.location,
      })),
      findingCount: result.findings.length,
      clean: result.clean,
    });
  }

  return { result, enrichment, suppressedCount };
}
```

### 3.3 New Module Tree (Complete)

```
src/
  findings/
    fingerprint.ts          # Shared fingerprinting (leaf, no internal deps)
  suppressions/
    types.ts                # Suppression, SuppressionsFile
    schema.ts               # Zod validation for suppressions.json
    store.ts                # CRUD + eviction for .janitor/suppressions.json
    matcher.ts              # matchSuppression() — exact → scoped fallback
    lifecycle.ts            # create, touch, expire, revalidate
    prompt.ts               # buildSuppressionsBlock() for system prompt
    index.ts                # Re-exports
  history/
    types.ts                # ReviewRecord, FindingLedgerEntry, AnnotatedFinding
    schema.ts               # Zod validation for history.json
    store.ts                # CRUD + eviction + rebuildLedger()
    analyzer.ts             # analyzeLifecycle(), detectResolved()
    trends.ts               # computeTrends()
    enrichment.ts           # enrichToastMessage(), buildHistorySection()
    index.ts                # Re-exports
  results/
    pipeline.ts             # NEW: processReviewOutput() — parse → suppress → analyze → enrich
```

### 3.4 Dependency Graph

```
fingerprint.ts (leaf — no internal deps)
    ↑
    ├── suppressions/matcher.ts
    ├── suppressions/lifecycle.ts
    ├── history/analyzer.ts
    └── results/pipeline.ts

suppressions/store.ts
    ↑
    └── results/pipeline.ts

history/store.ts
    ↑
    └── results/pipeline.ts

results/pipeline.ts (new orchestration point)
    ↑
    └── review/orchestrator.ts (existing — calls pipeline instead of raw parser)
```

---

## Part 4: Implementation Sequence

Suggested implementation order to keep each step testable:

1. **`src/findings/fingerprint.ts`** — leaf module, can be unit tested in isolation
2. **`src/suppressions/types.ts` + `schema.ts`** — type definitions
3. **`src/suppressions/store.ts`** — load/save/evict, test with fixture files
4. **`src/suppressions/matcher.ts`** — pure function, unit test with fixtures
5. **`src/suppressions/lifecycle.ts`** — create/touch/expire, unit test
6. **`src/suppressions/prompt.ts`** — pure string builder, unit test
7. **`src/history/types.ts` + `schema.ts`** — type definitions
8. **`src/history/store.ts`** — load/save/evict/rebuildLedger, test with fixtures
9. **`src/history/analyzer.ts`** — lifecycle analysis, unit test
10. **`src/history/trends.ts`** — trend computation, unit test
11. **`src/history/enrichment.ts`** — string formatting, unit test
12. **`src/results/pipeline.ts`** — integration point, wires everything together
13. **Config schema updates** — add `suppressions` and `history` blocks
14. **Wire into orchestrator** — replace direct parser call with pipeline
15. **Wire suppressions into prompt-builder** — append suppressions block
16. **Update sinks** — toast/session/file accept enrichment data
