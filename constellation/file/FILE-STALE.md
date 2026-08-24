---
name: stale.ts
status: verified
path: src/core/stale.ts
language: typescript
summary: The shared code-side drift verdict
connections:
  - FILE-GIT
  - FILE-CODE
  - FILE-SYNC
verified_sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
verified_at: '2026-08-18T17:56:53.097Z'
notes:
  - kind: state
    text: >-
      computeStaleCards translates at every git boundary: bound paths (code-root-relative) get the
      code root's repo-relative prefix before lastCommitByPath / changedFilesSince /
      dirtyFilesAmong, and results are stripped back, so all staleness output stays
      code-root-relative. Directory bindings round-trip through the same translation (underDirs).
      prefix '' is a true identity — single-package repos are byte-for-byte unchanged. See
      DECISION-MONOREPO-CODE-ROOT.
---

`computeStaleCards` compares every claim card (status built/verified, or carrying a
`verified_sha`) against its baseline and reports the cards whose bound code moved or
vanished. Bound paths come from [[FILE-CODE]]. Baselines, in precedence order:

1. **`verified_sha`** — an explicit "I checked this card at that sha".
2. **The card's own last commit** — code committed *after* the card is drift; a card and
   its code committed together is not. This is the ordinary loop, so drift stays quiet
   without anyone running `set_sync_point`, and only genuinely neglected cards light up.
3. **The passed base, else the `.sync.json` marker** — the fallback for cards git has
   never seen change (brand new, or renamed out of their history).

Uncommitted changes to bound code count as drift under every baseline, and a bound file
that vanished is drift on its own. `baseline_source` says which rule answered
(`verified_sha` | `card-commit` | `argument` | `sync-marker`).

The card-relative pass is **one** `git log --name-only` over every bound path *and* every
claim card file ([[FILE-GIT]]'s `lastCommitByPath`), plus one `git diff HEAD` for the
uncommitted check: paths are ordered by their position in that single newest-first walk,
so "newer" needs no timestamp trust and same-commit means equal position. Cards that fall
back to a sha baseline still diff **once per distinct baseline**, not once per card. A
card with no baseline at all (or an unreachable one) lands in `no_baseline` with a reason
instead of being silently reported clean.

Bound **files** match a changed path by equality; bound **directories** match by prefix
(`boundPathsOverlap` in [[FILE-CODE]]). That asymmetry is forced: git names the individual
files a commit touched and never the folder, so a card bound to `tests` would register no
drift at all under equality. A trailing slash (`tests/`) is stripped first so it cannot
miss the prefix. The report names the changed files themselves, not the folder —
"3 files changed" is the signal, "tests changed" is not.

Extracted from the MCP server so `stale_report` / `check_sync` and the viewer's `/api/sync`
dashboard payload share one implementation. The verdict is computed live on every call and
never written back to a card — only the `verified_sha` provenance is stored.
