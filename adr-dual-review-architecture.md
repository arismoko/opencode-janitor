# ADR: Dual-Agent Review Architecture

Date: 2026-02-08
Status: Accepted

## Context

The plugin originally had one agent (janitor) and one trigger path (commit).
We need both structural commit reviews and comprehensive PR reviews, with graceful
fallback when GitHub CLI is unavailable.

## Decision

1. Keep two distinct agents:
   - `janitor` (structural: DRY, DEAD, STRUCTURAL domains)
   - `bug-hunter` (comprehensive: BUG, SECURITY, PERFORMANCE, ARCHITECTURE, DOCS, SPEC domains)

2. Add trigger modes per agent:
   - `commit | pr | both | never`
   - Defaults:
     - janitor: `commit`
     - hunter: `pr`

3. Use two orchestrators (one per agent), each with its own `ReviewRunQueue` and
   `ReviewStrategy`, while reusing shared infrastructure (prompt builder, runner,
   output codec, sink transports).

4. Use a hybrid PR detection model:
   - Tool hook accelerator (`git push`, `gh pr ...`)
   - Polling detector
   - `gh pr view` when `gh` is available
   - Branch+HEAD fallback when `gh` is unavailable (best effort)

5. PR delivery behavior:
   - Always deliver to existing sinks (toast, session message, file)
   - Attempt `gh pr review --comment` when enabled and available
   - Fail soft on missing `gh`/auth errors

6. Hunter output contract is strict JSON:

```json
{
  "findings": [
    {
      "location": "path:line",
      "severity": "P0|P1|P2|P3",
      "domain": "BUG|SECURITY|PERFORMANCE|ARCHITECTURE|DOCS|SPEC",
      "evidence": "...",
      "prescription": "..."
    }
  ]
}
```

## Consequences

- Better separation of concerns: janitor stays narrow and reliable.
- Comprehensive reviews now have a dedicated agent, strategy, and parser.
- Plugin remains usable without `gh`.
- Config surface is larger (`agents.*`, `pr.*`, `delivery.hunter.*`).
