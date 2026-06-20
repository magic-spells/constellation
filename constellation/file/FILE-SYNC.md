---
name: sync.ts
status: built
path: src/core/sync.ts
language: typescript
summary: 'computeSyncStatus: a live freshness verdict'
---

Composes git + lint + status rollup into one glanceable state — `in-sync` / `drifted` / `dirty` / `never-synced` / `no-git`, plus a `marker_error` (forcing `drifted`) when the marker sha is unreachable. Computed live on every call, never stored.
