---
name: git
kind: cli
status: verified
connections:
  - FILE-GIT
verified_sha: c813887e9d1d4021d5129c1534e33f12efbc533d
verified_at: '2026-08-16T02:39:56.854Z'
---

The change-tracking backbone; [[FILE-GIT]] shells out to it for diff / log / rev-list (revisions guarded by safeRev, with --end-of-options at most call sites).
