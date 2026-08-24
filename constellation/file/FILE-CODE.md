---
name: code.ts
status: verified
path: src/core/code.ts
language: typescript
summary: Code binding + attach (same-repo, contained, capped)
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
verified_at: '2026-08-24T21:10:22.631Z'
notes:
  - kind: verified
    text: >-
      Verified code attachment plus atlas codeMetrics: contained bound paths, bounded directory
      walks (1,500 files / depth 12), and no synthetic zero for unbound cards.
    sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
  - kind: state
    text: >-
      Bound-path resolution, the containment + symlink guards, and codeMetrics now resolve against
      the CODE ROOT (codeRootFor) instead of the git root; skip reasons read 'outside code root' /
      'symlink escapes code root'. The repo_root result key keeps its name for API compatibility but
      carries the code root. Batch callers thread { codeRoot } once per plan (perf batching
      preserved). codeRootFor does not throw outside a git repo, so resolution/metrics now work in a
      git-less plan (deliberate improvement). See DECISION-MONOREPO-CODE-ROOT.
---

Resolves a card's bound files — connected FILE `path:` + own `code_refs` — and attaches their contents under per-file (64 KB) and total (256 KB) caps, skipping binaries / lockfiles / generated and rejecting paths (incl. symlinks) that escape the **code root** — the folder containing `constellation/`, or PLAN-PROJECT's `code_root` ([[FILE-REPOS]]'s `codeRootFor`), which is not the git root in a monorepo. A file over the per-file cap attaches its head with `truncated: true` rather than being skipped. Shared by `get_card` code mode, stale_report, and assemble.

`codeMetrics(index)` is the separate sizing pass behind the atlas's code-size lens. It returns per-card file, byte, and line totals across the same bound paths, including directory bindings. Directory walks are bounded (1,500 files, depth 12), skip dependency/build/vendor trees, never follow symlinks, and omit unbound cards rather than reporting a misleading zero. [[FILE-SERVE]] caches the result for `GET /api/atlas-metrics`.

A bound path may be a **directory** (`code_refs: [tests]`) when the unit a card describes is the folder. It resolves as `exists: true, dir: true` — never as a missing file — and its contents are never attached in `direct` mode (`skipped: 'directory'`): a folder would blow the budget on the first ref and give the caller no say in what came back. Bind the files that matter to get contents. Drift over a directory is [[FILE-STALE]]'s job, by prefix.

Paths are normalized (`tests/` → `tests`, `\\` → `/`) before equality or prefix matching, so a trailing slash cannot hide drift. `boundPathsOverlap` is the shared rule: a folder overlaps every path under it; `src/api` does not overlap `src/api-client`.
