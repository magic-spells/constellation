---
name: repos.ts
status: built
path: src/core/repos.ts
language: typescript
summary: Connected-repo declarations + repo selector resolution
connections:
  - FILE-MCP-SERVER
verified_sha: d5c77f0d44725ae7ab3236c191caef3c3332016c
verified_at: '2026-08-16T00:47:22.586Z'
---

Reads/writes `connected_repos` on PLAN-PROJECT and resolves the `repo` selector (name or path) to a sibling plan root. Repo-level links only — cards never connect across repos.
