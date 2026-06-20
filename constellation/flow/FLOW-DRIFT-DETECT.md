---
name: Code-side drift detection
kind: sync
status: built
---

Makes a `built`/`verified` claim re-verifiable instead of taken on faith (reverse drift).

1. `set_verified` stamps `verified_sha` = the git sha a card was checked at — [[FILE-CODE]].
2. Later, the card's bound code (a connected FILE `path:` or its own `code_refs`) changes.
3. `stale_report` / `check_sync` diff the bound files against `verified_sha` and flag the card — [[FILE-SYNC]]. The verdict is computed live, never stored. See [[DOC-MCP-UPGRADES]].
