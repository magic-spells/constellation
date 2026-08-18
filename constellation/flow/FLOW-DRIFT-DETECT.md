---
name: Code-side drift detection
kind: sync
status: verified
connections:
  - FILE-CODE
  - FILE-SYNC
  - FILE-STALE
section: plan-and-code
order: 30
verified_at: '2026-08-18T17:56:53.341Z'
verified_sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
---

Makes a `built`/`verified` claim re-verifiable instead of taken on faith (reverse drift).

1. `set_verified` stamps `verified_sha` = the git sha a card was checked at — [[FILE-CODE]].
2. Later, the card's bound code (a connected FILE `path:` or its own `code_refs`) changes.
3. `stale_report` / `check_sync` diff the bound files against `verified_sha` and flag the card — [[FILE-SYNC]]. The verdict is computed live, never stored. See [[DOC-MCP-UPGRADES]].
