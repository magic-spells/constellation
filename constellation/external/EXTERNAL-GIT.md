---
name: git
kind: cli
status: built
connections:
  - FILE-GIT
---

The change-tracking backbone; [[FILE-GIT]] shells out to it for diff / log / rev-list (revisions guarded by safeRev + --end-of-options).
