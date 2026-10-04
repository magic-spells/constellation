---
name: git
kind: cli
status: verified
connections:
  - FILE-GIT
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
verified_at: '2026-08-24T21:11:02.182Z'
notes:
  - kind: state
    text: >-
      Working memory (src/core/working.ts) also shells out to git: rev-parse for the anchor root
      (--git-common-dir, so worktrees share one folder) and a hardened ls-files trust check that
      refuses tracked or shipped .constellation/ files.
---

The change-tracking backbone; [[FILE-GIT]] shells out to it for diff / log / rev-list (revisions guarded by safeRev, with --end-of-options at most call sites).
