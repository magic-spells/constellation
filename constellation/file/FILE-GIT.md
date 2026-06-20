---
name: git.ts
status: built
path: src/core/git.ts
language: typescript
summary: Git plumbing for change tracking + drift
---

`diffPlan` (per-card delta), `planLog`, sync-marker read/write, `headSha`, `changedFilesSince`, `countCodeCommitsSince`, `recentPlanActivity`. Every caller-supplied revision is guarded by `safeRev` + `--end-of-options` so a dash-leading value can't be parsed as a git option.
