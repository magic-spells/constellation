---
name: version.ts
status: verified
path: src/core/version.ts
language: typescript
summary: This package's own version, read once
connections:
  - FILE-GIT
  - FILE-MCP-SERVER
  - FILE-SCAFFOLD
  - FILE-SERVE
verified_at: '2026-08-16T02:33:23.542Z'
verified_sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
---

`CONSTELLATION_VERSION` — the version of the Constellation the caller is *running*, read once from the package root (`../..` resolves there from both `src/core/` and `dist/core/`). Distinct from [[FILE-SYNC]]'s `packageVersion`, which reads the **workspace's** package.json; `orient` compares the two.

It exists because three call sites need it and none should own it: the MCP server (handshake version, and the version `set_sync_point format_review: true` stamps), [[FILE-SCAFFOLD]] (the stamp a new plan is born with), and [[FILE-SERVE]] (the same stamp from `POST /api/sync-point`).
