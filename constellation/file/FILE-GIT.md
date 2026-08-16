---
name: git.ts
status: built
path: src/core/git.ts
language: typescript
summary: Git plumbing for change tracking + drift
---

`diffPlan` (per-card delta), `planLog`, sync-marker read/write, `headSha`, `changedFilesSince`, `lastCommitByPath`, `dirtyFilesAmong`, `countCodeCommitsSince`, `recentPlanActivity`, `recentCodeActivity`, `latestTag`. Every caller-supplied revision is guarded by `safeRev` + `--end-of-options` so a dash-leading value can't be parsed as a git option.

`lastCommitByPath` is the card-relative drift primitive ([[FILE-STALE]]): one `git log --name-only` over a set of paths, returning each path's newest commit **and its position in that single newest-first walk**. Comparing positions makes "this file is newer than that one" a fact about one ordered walk rather than a comparison of two timestamps, and equal position means the same commit. A path absent from the result has no history at all — the caller's cue to fall back. `dirtyFilesAmong` is the companion `git diff --name-only HEAD` pass: uncommitted work no commit order can account for.

`.sync.json` carries two independent stamps and every write merges over the other: `synced_sha` / `synced_at` (the reconciliation point, `writeSyncPoint`) and `format_review` (the Constellation version whose file-format rules the plan was last reviewed under — `stampFormatReview` writes it, `formatReviewVersion` reads it). `readSyncMarker` returns the file whatever it holds; `readSyncPoint` returns it only when it pins a commit, so a marker carrying just `format_review` still reads as never-synced. The review stamp needs no git at all, which is what lets [[FILE-SCAFFOLD]] write it before the repo has a HEAD.
