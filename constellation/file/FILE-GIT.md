---
name: git.ts
status: built
path: src/core/git.ts
language: typescript
summary: Git plumbing for change tracking + drift
---

`diffPlan` (per-card delta), `planLog`, sync-marker read/write, `headSha`, `changedFilesSince`, `lastCommitByPath`, `dirtyFilesAmong`, `countCodeCommitsSince`, `recentPlanActivity`, `recentCodeActivity`, `latestTag`. Every caller-supplied revision is guarded by `safeRev` + `--end-of-options` so a dash-leading value can't be parsed as a git option.

`lastCommitByPath` is the card-relative drift primitive ([[FILE-STALE]]): one `git log --name-only` over a set of paths, returning each path's newest commit **and its position in that single newest-first walk**. Comparing positions makes "this file is newer than that one" a fact about one ordered walk rather than a comparison of two timestamps, and equal position means the same commit. A path absent from the result has no history at all — the caller's cue to fall back. `dirtyFilesAmong` is the companion `git diff --name-only HEAD` pass: uncommitted work no commit order can account for.
