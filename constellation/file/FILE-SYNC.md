---
name: sync.ts
status: built
path: src/core/sync.ts
language: typescript
summary: 'computeSyncStatus: a live freshness verdict'
verified_sha: d5c77f0d44725ae7ab3236c191caef3c3332016c
verified_at: '2026-08-16T00:47:22.586Z'
---

Composes git + lint + status rollup into one glanceable state — `in-sync` / `drifted` / `dirty` / `never-synced` / `no-git`, plus a `marker_error` (forcing `drifted`) when the marker sha is unreachable. Per-card reverse drift from [[FILE-STALE]] is part of the verdict: a non-empty stale list is `drifted`, not `in-sync` (uncommitted edits to bound code, or a vanished bound file). Uncommitted plan edits still report `dirty` first. Computed live on every call, never stored.

`SyncStatus` also carries what the viewer's overview dashboard renders: `code_activity` (recent code commits), `latest_tag`, `package_version`, and `stale` — the code-side drift verdict from [[FILE-STALE]]. Callers that already hold a lint result or a stale result pass them in so one tool call never recomputes either twice.
