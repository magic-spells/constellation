---
name: stale.ts
status: built
path: src/core/stale.ts
language: typescript
summary: The shared code-side drift verdict
connections:
  - FILE-GIT
  - FILE-CODE
  - FILE-SYNC
---

`computeStaleCards` compares every claim card (status built/verified, or carrying a
`verified_sha`) against its baseline — its own `verified_sha`, else the passed base, else
the `.sync.json` marker — and reports the cards whose bound code moved or vanished. Bound
paths come from [[FILE-CODE]]; the diff runs **once per distinct baseline**, not once per
card, so a plan with 100 verified cards spawns one or two git calls, not 100. A card with
no baseline at all (or an unreachable one) lands in `no_baseline` with a reason instead of
being silently reported clean.

Extracted from the MCP server so `stale_report` / `check_sync` and the viewer's `/api/sync`
dashboard payload share one implementation. The verdict is computed live on every call and
never written back to a card — only the `verified_sha` provenance is stored.
