---
name: repos.ts
status: built
path: src/core/repos.ts
language: typescript
summary: Connected-repo declarations + repo selector resolution
---

Reads/writes `connected_repos` on PLAN-PROJECT and resolves the `repo` selector (name or path) to a sibling plan root. Repo-level links only — cards never connect across repos.
