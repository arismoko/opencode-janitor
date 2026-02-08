# ADR: Dual-Agent Review Architecture

Date: 2026-02-08
Status: Accepted

## Context

The plugin originally had one agent (janitor) and one trigger path (commit).
We need both structural commit reviews and comprehensive PR reviews, with graceful
fallback when GitHub CLI is unavailable.

## Decision

1. Keep two distinct agents:
   - `janitor` (structural only)
   - `code-reviewer` (bugs/security/performance/architecture/docs/spec)

2. Add trigger modes per agent:
   - `commit | pr | both`
   - Defaults:
     - janitor: `commit`
     - reviewer: `pr`

3. Use two orchestrators (one per agent), each with its own queue and session
   tracking, while reusing shared infrastructure patterns.

4. Use a hybrid PR detection model:
   - Tool hook accelerator (`git push`, `gh pr ...`)
   - Polling detector
   - `gh pr view` when `gh` is available
   - Branch+HEAD fallback when `gh` is unavailable (best effort)

5. PR delivery behavior:
   - Always deliver to existing sinks (toast, session message, file)
   - Attempt `gh pr review --comment` when enabled and available
   - Fail soft on missing `gh`/auth errors

6. Reviewer output contract is strict JSON:

```json
{
  "findings": [
    {
      "location": "path:line",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "domain": "BUG|SECURITY|PERFORMANCE|ARCHITECTURE|DOCS|SPEC",
      "evidence": "...",
      "prescription": "..."
    }
  ]
}
```

## Consequences

- Better separation of concerns: janitor stays narrow and reliable.
- Comprehensive reviews now have a dedicated path and parser.
- Plugin remains usable without `gh`.
- Config surface is larger (`agents.*`, `pr.*`, `delivery.reviewer.*`).

## Compatibility

- Legacy `autoReview.onCommit` is still honored for janitor when
  `agents.janitor` is not explicitly configured.
