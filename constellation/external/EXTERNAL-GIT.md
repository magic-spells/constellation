---
name: git
kind: cli
status: verified
connections:
  - FILE-GIT
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
verified_at: '2026-08-24T21:11:02.182Z'
---

The change-tracking backbone; [[FILE-GIT]] shells out to it for diff / log / rev-list (revisions guarded by safeRev, with --end-of-options at most call sites).
