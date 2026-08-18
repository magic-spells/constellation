---
name: code.ts
status: verified
path: src/core/code.ts
language: typescript
summary: Code binding + attach (same-repo, contained, capped)
verified_sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
verified_at: '2026-08-18T17:56:52.833Z'
notes:
  - kind: verified
    text: >-
      Verified code attachment plus atlas codeMetrics: contained bound paths, bounded directory
      walks (1,500 files / depth 12), and no synthetic zero for unbound cards.
    sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
---

Resolves a card's bound files — connected FILE `path:` + own `code_refs` — and attaches their contents under per-file (64 KB) and total (256 KB) caps, skipping binaries / lockfiles / generated and rejecting paths (incl. symlinks) that escape the repo root. A file over the per-file cap attaches its head with `truncated: true` rather than being skipped. Shared by `get_card` code mode, stale_report, and assemble.

`codeMetrics(index)` is the separate sizing pass behind the atlas's code-size lens. It returns per-card file, byte, and line totals across the same bound paths, including directory bindings. Directory walks are bounded (1,500 files, depth 12), skip dependency/build/vendor trees, never follow symlinks, and omit unbound cards rather than reporting a misleading zero. [[FILE-SERVE]] caches the result for `GET /api/atlas-metrics`.

A bound path may be a **directory** (`code_refs: [tests]`) when the unit a card describes is the folder. It resolves as `exists: true, dir: true` — never as a missing file — and its contents are never attached in `direct` mode (`skipped: 'directory'`): a folder would blow the budget on the first ref and give the caller no say in what came back. Bind the files that matter to get contents. Drift over a directory is [[FILE-STALE]]'s job, by prefix.

Paths are normalized (`tests/` → `tests`, `\\` → `/`) before equality or prefix matching, so a trailing slash cannot hide drift. `boundPathsOverlap` is the shared rule: a folder overlaps every path under it; `src/api` does not overlap `src/api-client`.
