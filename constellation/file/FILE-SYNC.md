---
name: sync.ts
status: verified
path: src/core/sync.ts
language: typescript
summary: 'computeSyncStatus: a live freshness verdict'
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
notes:
  - kind: state
    text: >-
      packageVersion reads the CODE ROOT's package.json (was the git root's) — in a monorepo each
      package plan now reports its own version instead of the root shell's. Marker/base logic
      untouched; packageVersion is the only read of a workspace package.json in src/ (version.ts and
      the CLI read Constellation's own).
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

Composes git + lint + status rollup into one glanceable state — `in-sync` / `drifted` / `dirty` / `never-synced` / `no-git`, plus a `marker_error` (forcing `drifted`) when the marker sha is unreachable. Per-card reverse drift from [[FILE-STALE]] is part of the verdict: a non-empty stale list is `drifted`, not `in-sync` (uncommitted edits to bound code, or a vanished bound file). Uncommitted plan edits still report `dirty` first. Computed live on every call, never stored.

`SyncStatus` also carries what the viewer's overview dashboard renders: `code_activity` (recent code commits), `latest_tag`, `package_version`, and `stale` — the code-side drift verdict from [[FILE-STALE]]. Callers that already hold a lint result or a stale result pass them in so one tool call never recomputes either twice.
