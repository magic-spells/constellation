---
name: version.ts
status: built
path: src/core/version.ts
language: typescript
summary: This package's own version, read once
connections:
  - FILE-GIT
  - FILE-MCP-SERVER
  - FILE-SCAFFOLD
  - FILE-SERVE
---

`CONSTELLATION_VERSION` — the version of the Constellation the caller is *running*, read once from the package root (`../..` resolves there from both `src/core/` and `dist/core/`). Distinct from [[FILE-SYNC]]'s `packageVersion`, which reads the **workspace's** package.json; `orient` compares the two.

It exists because three call sites need it and none should own it: the MCP server (handshake version, and the version `set_sync_point format_review: true` stamps), [[FILE-SCAFFOLD]] (the stamp a new plan is born with), and [[FILE-SERVE]] (the same stamp from `POST /api/sync-point`).
