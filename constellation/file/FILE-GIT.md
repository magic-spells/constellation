---
name: git.ts
status: verified
path: src/core/git.ts
language: typescript
summary: Git plumbing for change tracking + drift
verified_at: '2026-08-16T02:38:59.880Z'
verified_sha: 623af52933900eb27ccb1d3061a33b40a4da16ee
notes:
  - kind: verified
    text: >-
      Re-read against git.ts: the export list now carries repoRemoteUrl, with its own paragraph
      noting it answers "where does the code live" rather than "how did it change" — the one
      function here outside the change-tracking remit.
    sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
  - kind: verified
    text: >-
      writeSyncPoint's explicit-sha branch was stamping "--end-of-options\n<sha>" into the marker —
      rev-parse echoes that flag as output. Now routes through resolveCommit (--verify). The card
      documents the trap; tests/sync.test.ts covers the branch, which previously had none.
    sha: 623af52933900eb27ccb1d3061a33b40a4da16ee
  - kind: state
    text: >-
      recentCodeActivity and countCodeCommitsSince are pathspec-scoped to the plan's code root (were
      '.' / no pathspec) and both pass --full-history: a bare pathspec enables git's TREESAME merge
      simplification, which silently pruned real code commits reachable only via the un-followed
      parent (proven on this repo: 4 real commits dropped, e.g. the viewer sidebar chain via PR
      #11's merge shape). planRootsFor added to compute { codeRoot, gitRoot, prefix } per plan.
---

`diffPlan` (per-card delta), `planLog`, sync-marker read/write, `headSha`, `changedFilesSince`, `lastCommitByPath`, `dirtyFilesAmong`, `countCodeCommitsSince`, `recentPlanActivity`, `recentCodeActivity`, `latestTag`, `planRootsFor`, `repoRemoteUrl`. `safeRev` rejects a dash-leading revision at every entry point, so no caller string is parsed as a git option. `--end-of-options` backs it at most sites but not all: `countCodeCommitsSince`'s `rev-list --count` omits it, and `diffPlan`'s `git show` pair passes revisions raw — safe only because an earlier `safeRev` in the same function throws first. Ordering, not a guard.

Two exports answer *where the code lives* rather than how it changed — the only ones outside this module's change-tracking remit. `planRootsFor` resolves a plan's `{ codeRoot, gitRoot, prefix }`, and that `prefix` is what every caller uses to translate code-root-relative bound paths into the repo-relative paths git speaks (see [[FILE-STALE]]); it is also what scopes `recentCodeActivity` / `countCodeCommitsSince` to one package in a monorepo. `repoRemoteUrl` reads `origin` and normalises it to a browsable https URL — ssh forms (`git@host:owner/repo`) rewritten, trailing `.git` stripped — returning null when there is no remote, no repo, or the result is not http(s); [[FILE-SERVE]] hands it to the viewer as `repo_url`.

`lastCommitByPath` is the card-relative drift primitive ([[FILE-STALE]]): one `git log --name-only` over a set of paths, returning each path's newest commit **and its position in that single newest-first walk**. Comparing positions makes "this file is newer than that one" a fact about one ordered walk rather than a comparison of two timestamps, and equal position means the same commit. A path absent from the result has no history at all — the caller's cue to fall back. `dirtyFilesAmong` is the companion `git diff --name-only HEAD` pass: uncommitted work no commit order can account for.

`writeSyncPoint` resolves a caller-supplied revision through `resolveCommit`, never a bare `rev-parse --end-of-options <rev>`: **rev-parse echoes that flag back as its own first output line**, so the bare form stamped `--end-of-options\n<sha>` into the marker — a sha nothing resolves, which reads as `marker_error` and pins the plan at `drifted` permanently. `--verify` prints exactly one line and fails loudly on a revision that does not exist. Only the explicit-sha branch was ever affected (the default HEAD path takes no flag), which is why it went unnoticed until an explicit sha was passed.

`.sync.json` carries two independent stamps and every write merges over the other: `synced_sha` / `synced_at` (the reconciliation point, `writeSyncPoint`) and `format_review` (the Constellation version whose file-format rules the plan was last reviewed under — `stampFormatReview` writes it, `formatReviewVersion` reads it). `readSyncMarker` returns the file whatever it holds; `readSyncPoint` returns it only when it pins a commit, so a marker carrying just `format_review` still reads as never-synced. The review stamp needs no git at all, which is what lets [[FILE-SCAFFOLD]] write it before the repo has a HEAD.
