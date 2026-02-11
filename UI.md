---

### 1. `keymap/keymap.ts` — Remove `o`/`s`, add `t`

```diff
 export const GLOBAL_KEYMAP: ScopedKeymap = {
   scope: 'global',
   bindings: [
     bind('1', 'Reports', 'view:reports'),
     bind('2', 'Repos', 'view:repos'),
     bind('3', 'Activity', 'view:activity'),
     bind('R', 'Run agent…', 'review:trigger'),
     bind('D', 'Delete report', 'report:delete'),
     bind('y', 'Copy report', 'report:copy'),
     bind('f', 'Cycle filter', 'activity:filter_next'),
-    bind('s', 'Cycle scope', 'stream:scope_next'),
-    bind('o', 'Stream run', 'stream:scope_report'),
+    bind('t', 'Toggle view', 'detail:toggle_mode'),
     bind('p', 'Pause stream', 'stream:pause'),
     bind('q', 'Quit', 'app:quit'),
     bind('r', 'Refresh', 'app:refresh'),
   ],
 };
```

---

### 2. `types.ts` — Add `DetailMode`, re-export `EventsResponse`

```diff
 export type {
   ...
   EventJournalEntry,
+  EventsResponse,
 } from '../ipc/protocol';

 export type StreamState = 'connecting' | 'live' | 'stale' | 'error';
-export type StreamScope = 'all' | 'repo' | 'report';
+export type StreamScope = 'all' | 'repo' | 'report';  // keep type, but no longer user-controlled
 export type ViewMode = 'reports' | 'repos' | 'activity';
 export type FocusPane = 'list' | 'detail';
+export type DetailMode = 'findings' | 'session';
```

---

### 3. `daemon-client.ts` — Add `fetchSessionEvents()`

```typescript
/** Fetch historical session events for an agent run from the event journal. */
export function fetchSessionEvents(
  options: DaemonClientOptions,
  agentRunId: string,
  params?: { limit?: number },
): Promise<JsonResponse<EventsResponse | ErrorResponse>> {
  const search = new URLSearchParams();
  search.set("agentRunId", agentRunId);
  search.set("afterSeq", "0"); // from beginning
  if (params?.limit !== undefined) {
    search.set("limit", String(params.limit));
  } else {
    search.set("limit", "500"); // reasonable default
  }

  return requestJson<EventsResponse | ErrorResponse>({
    socketPath: options.socketPath,
    path: `/v1/events?${search.toString()}`,
    method: "GET",
    timeoutMs: options.timeoutMs,
  });
}
```

This uses the existing `GET /v1/events?agentRunId=xxx` endpoint.

---

### 4. `helpers.ts` — Add `buildTranscript()`

```typescript
/**
 * Build a flowing transcript string from session events.
 *
 * - `session.delta` events: append the raw `delta` text preserving newlines.
 * - `session.status` / `session.idle` / `session.error`: insert a marker line.
 *
 * Returns the concatenated transcript string.
 */
export function buildTranscript(events: EventJournalEntry[]): string {
  const parts: string[] = [];

  for (const ev of events) {
    if (ev.topic === "session.delta") {
      const delta =
        typeof ev.payload.delta === "string" ? ev.payload.delta : ev.message;
      parts.push(delta);
    } else if (ev.topic.startsWith("session.")) {
      const label = ev.topic.replace("session.", "").toUpperCase();
      const msg = ev.message || label;
      parts.push(`\n--- ${label}: ${msg} ---\n`);
    }
  }

  return parts.join("");
}

/**
 * Split a string into visual lines respecting a max width.
 * Uses word-boundary wrapping (greedy). Each output line is at most `width` chars.
 */
export function wrapLines(text: string, width: number): string[] {
  if (width <= 0) return [];
  const result: string[] = [];

  for (const rawLine of text.split("\n")) {
    if (rawLine.length === 0) {
      result.push("");
      continue;
    }
    let remaining = rawLine;
    while (remaining.length > width) {
      // Find last space within width
      let breakAt = remaining.lastIndexOf(" ", width);
      if (breakAt <= 0) breakAt = width; // no space found, hard-break
      result.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).replace(/^ /, ""); // trim leading space
    }
    result.push(remaining);
  }

  return result;
}
```

---

### 5. `header.tsx` — Remove `scopeLabel`, add `●` dot indicator

```diff
 export interface HeaderProps {
   viewMode: ViewMode;
   streamState: StreamState;
   paused: boolean;
   reposEnabled: number;
   reposTotal: number;
   runningJobs: number;
   queuedJobs: number;
   reportsCount: number;
   uptimeMs: number;
   lastRefreshAgoMs: number;
-  scopeLabel: string;
 }

 export function Header(props: HeaderProps) {
   const {
     viewMode,
     streamState,
     paused,
     ...
-    scopeLabel,
   } = props;

-  const scoped = scopeLabel !== 'all';

   return (
     <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
       <Box justifyContent="space-between">
         <Box>
           <Text bold color="cyan">JANITOR </Text>
           <ViewTabs current={viewMode} />
         </Box>
         <Box>
           <Text color={streamStateColor(streamState)}>
-            {streamState.toUpperCase()} {paused ? '(PAUSED)' : ''}
+            ● {streamState.toUpperCase()}{paused ? ' (PAUSED)' : ''}
           </Text>
-          {scoped && <Text color="cyan"> scope:{scopeLabel}</Text>}
         </Box>
       </Box>
       <Box justifyContent="space-between">
         <Text color="gray">
-          repos {reposEnabled}/{reposTotal} -- jobs {runningJobs}r/
-          {queuedJobs}q -- reports {reportsCount}
+          repos {reposEnabled}/{reposTotal}  ·  jobs {runningJobs}r/{queuedJobs}q  ·  reports {reportsCount}
         </Text>
         <Text color="gray">
-          uptime {shortDuration(uptimeMs)} -- refresh{' '}
-          {shortDuration(lastRefreshAgoMs)} ago
+          uptime {shortDuration(uptimeMs)}  ·  refresh {shortDuration(lastRefreshAgoMs)} ago
         </Text>
       </Box>
     </Box>
   );
```

---

### 6. `keybindings-footer.tsx` — Remove `o`/`s`/`scopeLabel`, add `t`, group keys

```diff
 export interface KeybindingsFooterProps {
   viewMode: ViewMode;
   focusPane: FocusPane;
-  scopeLabel: string;
+  /** Whether `t` toggle is contextually available (report detail of completed run). */
+  showToggle: boolean;
 }

 export function KeybindingsFooter(props: KeybindingsFooterProps) {
-  const { viewMode, focusPane, scopeLabel } = props;
+  const { viewMode, focusPane, showToggle } = props;

   let content: string;

   if (viewMode === 'reports' && focusPane === 'detail') {
-    content = '1/2/3 view · j/k scroll · h/esc back · y copy · D delete · R run agent · o stream run · s scope · r refresh · p pause · q quit';
+    const toggle = showToggle ? ' t toggle ╎' : '';
+    content = `1/2/3 view ╎ j/k scroll  h/esc back ╎ y copy  D del  R run ╎${toggle} r refresh  p pause  q quit`;
   } else if (viewMode === 'reports') {
-    content = '1/2/3 view · j/k move · g/G top/bottom · Enter/l open · y copy · D delete · R run agent · o stream run · s scope · r refresh · p pause · q quit';
+    content = '1/2/3 view ╎ j/k move  g/G jump ╎ Enter open ╎ y copy  D del  R run ╎ r refresh  p pause  q quit';
   } else if (viewMode === 'activity') {
-    content = '1/2/3 view · j/k scroll · g/G top/bottom · f filter · o stream run · s scope · r refresh · p pause · q quit';
+    content = '1/2/3 view ╎ j/k scroll  g/G jump ╎ f filter ╎ r refresh  p pause  q quit';
   } else {
     // repos
-    content = '1/2/3 view · j/k move · g/G top/bottom · R run agent · o stream run · s scope · r refresh · p pause · q quit';
+    content = '1/2/3 view ╎ j/k move  g/G jump ╎ R run ╎ r refresh  p pause  q quit';
   }

-  const scoped = scopeLabel !== 'all';

   return (
     <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
-      <Text color={scoped ? 'cyan' : 'gray'}>stream:{scopeLabel}</Text>
-      <Text color="gray"> · {content}</Text>
+      <Text color="gray">{content}</Text>
     </Box>
   );
```

---

### 7. `report-detail-pane.tsx` — Major refactor for session/findings exclusivity

New props interface:

```typescript
export interface ReportDetailPaneProps {
  detail: CachedReportDetail | null;
  loading: boolean;
  error: string | null;
  detailOffset: number;
  detailVisibleRows: number;
  termWidth: number;
  nowTs: number;
  /** Controls what the detail pane displays. */
  detailMode: DetailMode;
  /** Live session events for running reports (from SSE stream). */
  sessionEvents?: EventJournalEntry[];
  /** Historical session events for completed reports (from API fetch). */
  historicalSessionEvents?: EventJournalEntry[];
}
```

Body logic (pseudo-code):

```tsx
export function ReportDetailPane(props: ReportDetailPaneProps) {
  const {
    detail,
    loading,
    error,
    detailOffset,
    detailVisibleRows,
    termWidth,
    nowTs,
    detailMode,
    sessionEvents = [],
    historicalSessionEvents = [],
  } = props;

  // ... loading/error/empty guards (unchanged) ...

  const { report, findings, rawOutput } = detail.data;
  const si = statusIcon(report.status);
  const contentWidth = Math.max(20, termWidth - 4);
  const isRunning = report.status === "running" || report.status === "queued";
  const showSession = detailMode === "session";
  const modeHint = showSession ? "(t for findings)" : "(t for session)";

  return (
    <Box flexDirection="column">
      {/* Compact metadata header — always visible (unchanged) */}
      <Box>
        <Text color={si.color} bold>
          {si.icon} {report.agent}
        </Text>
        <Text color="gray">
          {" "}
          {report.status}
          {report.outcome ? ` / ${report.outcome}` : ""}
        </Text>
        <Text color="gray">
          {" -- "}
          {shortRepoName(report.repoPath)}
          {report.subjectKey ? ` / ${report.subjectKey}` : ""}
        </Text>
      </Box>
      <Box>
        <Text color="gray" dimColor>
          started{" "}
          {report.startedAt ? relativeTime(report.startedAt, nowTs) : "-"}
          {"  ·  "}
          finished{" "}
          {report.finishedAt ? relativeTime(report.finishedAt, nowTs) : "-"}
        </Text>
      </Box>
      {report.errorMessage && (
        <Text color="red" wrap="wrap">
          error: {report.errorMessage}
        </Text>
      )}

      {/* Severity summary — always visible */}
      <Box marginTop={1}>
        {report.p0Count > 0 && (
          <Text color="red" bold>
            P0:{report.p0Count}{" "}
          </Text>
        )}
        {report.p1Count > 0 && (
          <Text color="yellow" bold>
            P1:{report.p1Count}{" "}
          </Text>
        )}
        {report.p2Count > 0 && <Text color="blue">P2:{report.p2Count} </Text>}
        {report.p3Count > 0 && <Text color="gray">P3:{report.p3Count} </Text>}
        {report.findingsCount === 0 && <Text color="gray">No findings</Text>}
      </Box>

      {/* ---- MUTUALLY EXCLUSIVE SECTION ---- */}

      {showSession ? (
        <SessionSection
          events={isRunning ? sessionEvents : historicalSessionEvents}
          isLive={isRunning}
          contentWidth={contentWidth}
          visibleLines={detailVisibleRows * 5} // more vertical space since no findings
          scrollOffset={detailOffset}
          modeHint={isRunning ? undefined : modeHint}
        />
      ) : (
        <FindingsSection
          findings={findings}
          rawOutput={rawOutput}
          contentWidth={contentWidth}
          detailOffset={detailOffset}
          detailVisibleRows={detailVisibleRows}
          modeHint={modeHint}
        />
      )}
    </Box>
  );
}
```

**SessionSection** (inline or extracted component):

```tsx
function SessionSection({
  events,
  isLive,
  contentWidth,
  visibleLines,
  scrollOffset,
  modeHint,
}) {
  const transcript = buildTranscript(events);
  const lines = wrapLines(transcript, contentWidth - 2);

  // For live: auto-scroll to bottom (show last N lines)
  // For history: scrollable from scrollOffset
  const totalLines = lines.length;
  let startLine: number;
  if (isLive) {
    startLine = Math.max(0, totalLines - visibleLines);
  } else {
    startLine = clamp(scrollOffset, 0, Math.max(0, totalLines - visibleLines));
  }
  const endLine = Math.min(totalLines, startLine + visibleLines);
  const visibleSlice = lines.slice(startLine, endLine);

  const headerRight = isLive ? "● live" : (modeHint ?? "");

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray" dimColor>
        ── {isLive ? "Session" : "Session History"} ──
        {"─".repeat(Math.max(0, contentWidth - 28 - headerRight.length))}{" "}
        {headerRight} ──
      </Text>
      {visibleSlice.length === 0 ? (
        <Text color="gray">No session events.</Text>
      ) : (
        visibleSlice.map((line, i) => (
          <Text key={startLine + i} wrap="truncate-end">
            {isLive && i === visibleSlice.length - 1 ? `${line}▌` : line}
          </Text>
        ))
      )}
      {!isLive && endLine < totalLines && (
        <Text color="gray" dimColor>
          ↕ j/k to scroll ({totalLines - endLine} more)
        </Text>
      )}
    </Box>
  );
}
```

**FindingsSection** (extracted from current findings rendering):

```tsx
function FindingsSection({ findings, rawOutput, contentWidth, detailOffset, detailVisibleRows, modeHint }) {
  return (
    <>
      {findings.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray" dimColor>
            ── Findings {detailOffset + 1}-{Math.min(detailOffset + detailVisibleRows, findings.length)} of {findings.length} ──{'─'.repeat(...)} {modeHint} ──
          </Text>
          {findings.slice(detailOffset, detailOffset + detailVisibleRows).map(f => (
            <FindingRow key={f.id} finding={f} width={contentWidth} />
          ))}
          {detailOffset + detailVisibleRows < findings.length && (
            <Text color="gray" dimColor>↓ {findings.length - detailOffset - detailVisibleRows} more (j/k to scroll)</Text>
          )}
        </Box>
      ) : rawOutput ? (
        <Box flexDirection="column" marginTop={1} width={contentWidth}>
          <Text color="gray" dimColor>Raw output (no structured findings):</Text>
          <Text wrap="wrap">{rawOutput}</Text>
        </Box>
      ) : null}
    </>
  );
}
```

---

### 8. `views/reports-view.tsx` — Pass `detailMode` through

```diff
 export interface ReportsViewProps {
   ...
   sessionEvents: EventJournalEntry[];
+  detailMode: DetailMode;
+  historicalSessionEvents: EventJournalEntry[];
 }

 ...
         <ReportDetailPane
           detail={currentDetail}
           loading={detailLoading}
           error={detailError}
           detailOffset={detailOffset}
           detailVisibleRows={detailVisibleRows}
           termWidth={detailPaneWidth}
           nowTs={nowTs}
           sessionEvents={sessionEvents}
+          detailMode={detailMode}
+          historicalSessionEvents={historicalSessionEvents}
         />
```

---

### 9. `app.tsx` — The big one

**a) Remove `streamScope` manual state → auto-derive from context:**

```diff
-  const [streamScope, setStreamScope] = useState<StreamScope>('all');
+  // Auto-scope the stream based on current view and selection.
+  const streamScope = useMemo<StreamScope>(() => {
+    if (viewMode === 'reports' && selectedReport) return 'report';
+    if (viewMode === 'repos' && selectedRepo) return 'repo';
+    return 'all';
+  }, [viewMode, selectedReport, selectedRepo]);
```

**b) Add `detailMode` state with auto-flip:**

```typescript
const [detailMode, setDetailMode] = useState<DetailMode>("findings");
const [historicalSessionEvents, setHistoricalSessionEvents] = useState<
  EventJournalEntry[]
>([]);
const [historyLoading, setHistoryLoading] = useState(false);

// Auto-set detailMode based on report status
useEffect(() => {
  if (!selectedReport) {
    setDetailMode("findings");
    setHistoricalSessionEvents([]);
    return;
  }
  const isRunning =
    selectedReport.status === "running" || selectedReport.status === "queued";
  setDetailMode(isRunning ? "session" : "findings");
  setHistoricalSessionEvents([]);
}, [selectedReport?.id, selectedReport?.status]);
```

**c) Fetch historical session events when toggling to session mode on a completed report:**

```typescript
// Fetch historical session events for completed reports on demand
useEffect(() => {
  if (detailMode !== "session" || !selectedReport) return;
  const isRunning =
    selectedReport.status === "running" || selectedReport.status === "queued";
  if (isRunning) return; // live session uses SSE events, not API fetch

  let cancelled = false;
  setHistoryLoading(true);

  void fetchSessionEvents({ socketPath, timeoutMs: 5000 }, selectedReport.id, {
    limit: 500,
  })
    .then((response) => {
      if (cancelled) return;
      if (response.status === 200) {
        const data = response.data as EventsResponse;
        setHistoricalSessionEvents(data.events);
      }
    })
    .catch(() => {
      /* silently fail, user sees empty session */
    })
    .finally(() => {
      if (!cancelled) setHistoryLoading(false);
    });

  return () => {
    cancelled = true;
  };
}, [detailMode, selectedReport?.id, selectedReport?.status, socketPath]);
```

**d) Remove `stream:scope_next` and `stream:scope_report` handlers, add `detail:toggle_mode`:**

```diff
  const handleAction = useCallback((action: string) => {
    switch (action) {
      ...
-     case 'stream:scope_next': { ... return; }
-     case 'stream:scope_report': { ... return; }
+     case 'detail:toggle_mode': {
+       if (viewMode !== 'reports' || !selectedReport) return;
+       const isRunning = selectedReport.status === 'running' || selectedReport.status === 'queued';
+       if (isRunning) {
+         showFlash('Session is live — cannot toggle', 'yellow');
+         return;
+       }
+       setDetailMode((current) => {
+         const next = current === 'findings' ? 'session' : 'findings';
+         showFlash(`Detail: ${next}`, 'cyan');
+         return next;
+       });
+       setDetailOffset(0); // reset scroll
+       return;
+     }
      ...
    }
  }, [...]);
```

**e) Update `scopeFilterParams` useMemo — simplify since scope is auto-derived:**

```diff
-  const { scopeFilterParams, scopeLabel } = useMemo(() => {
+  const scopeFilterParams = useMemo(() => {
     if (streamScope === 'repo') {
       const repo = selectedRepo;
-      if (repo) {
-        return { scopeFilterParams: { repoId: repo.id }, scopeLabel: `repo:${shortRepoName(repo.path)}` };
-      }
-      return { scopeFilterParams: {}, scopeLabel: 'all' };
+      if (repo) return { repoId: repo.id } as Record<string, string>;
+      return {} as Record<string, string>;
     }
     if (streamScope === 'report') {
       const report = selectedReport;
-      if (report) {
-        return { scopeFilterParams: { agentRunId: report.id }, scopeLabel: `run:${report.id.slice(0, 10)}` };
-      }
-      return { scopeFilterParams: {}, scopeLabel: 'all' };
+      if (report) return { agentRunId: report.id } as Record<string, string>;
+      return {} as Record<string, string>;
     }
-    return { scopeFilterParams: {}, scopeLabel: 'all' };
+    return {} as Record<string, string>;
   }, [streamScope, selectedReport, selectedRepo]);
```

**f) Update component tree — remove `scopeLabel` from Header/Footer, add new props:**

```diff
       <Header
         ...
-        scopeLabel={scopeLabel}
       />
       ...
           <ReportsView
             ...
             sessionEvents={sessionEvents}
+            detailMode={detailMode}
+            historicalSessionEvents={historicalSessionEvents}
           />
       ...
       <KeybindingsFooter
         viewMode={viewMode}
         focusPane={focusPane}
-        scopeLabel={scopeLabel}
+        showToggle={viewMode === 'reports' && selectedReport != null && selectedReport.status !== 'running' && selectedReport.status !== 'queued'}
       />
```

**g) Update the SSE `useEffect` dependency — use `scopeFilterParams` directly (no `scopeLabel`):**

The SSE `useEffect` at line 310 already depends on `scopeFilterParams` — no change needed there since `scopeFilterParams` is now a standalone memo.

**h) Remove `StreamScope` import from types import list if unused, and add `DetailMode`/`EventsResponse`:**

```diff
 import type {
   CachedReportDetail,
   ...
-  StreamScope,
+  DetailMode,
+  EventsResponse,
   StreamState,
   ViewMode,
 } from './types';
+import { fetchSessionEvents } from './transport/daemon-client';
```

---

### 10. `db/migrations.ts` — Add index (performance)

Add as migration 6 (or append to existing):

```typescript
{
  version: 6,
  up: (db: Database) => {
    db.run(`CREATE INDEX IF NOT EXISTS idx_event_agent_run ON event_journal(agent_run_id, seq ASC)`);
  },
}
```

---

### Summary of all changes

| File                     | Lines changed (est.) | Nature                                                                            |
| ------------------------ | -------------------- | --------------------------------------------------------------------------------- |
| `keymap/keymap.ts`       | ~3                   | Remove 2 binds, add 1                                                             |
| `types.ts`               | ~3                   | Add `DetailMode`, re-export `EventsResponse`                                      |
| `daemon-client.ts`       | ~20                  | New `fetchSessionEvents()` function                                               |
| `helpers.ts`             | ~55                  | New `buildTranscript()` + `wrapLines()`                                           |
| `header.tsx`             | ~10                  | Remove `scopeLabel`, add `●`, use `·` separators                                  |
| `keybindings-footer.tsx` | ~20                  | Remove `o`/`s`/scope badge, add `t`, `╎` groups                                   |
| `report-detail-pane.tsx` | ~120                 | Major refactor: split into `SessionSection`/`FindingsSection`, mutual exclusivity |
| `views/reports-view.tsx` | ~5                   | Pass `detailMode` + `historicalSessionEvents` through                             |
| `app.tsx`                | ~80                  | Auto-scope, `detailMode` state, remove `o`/`s` handlers, fetch history            |
| `db/migrations.ts`       | ~5                   | New index on `agent_run_id`                                                       |
