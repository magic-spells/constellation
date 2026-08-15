---
name: sync.ts
status: built
path: src/core/sync.ts
language: typescript
summary: 'computeSyncStatus: a live freshness verdict'
---

Composes git + lint + status rollup into one glanceable state — `in-sync` / `drifted` / `dirty` / `never-synced` / `no-git`, plus a `marker_error` (forcing `drifted`) when the marker sha is unreachable. Computed live on every call, never stored.

`SyncStatus` also carries what the viewer's overview dashboard renders: `code_activity` (recent code commits), `latest_tag`, `package_version`, and `stale` — the code-side drift verdict from [[FILE-STALE]]. Callers that already hold a lint result or a stale result pass them in so one tool call never recomputes either twice.
