---
name: git
kind: cli
status: verified
connections:
  - FILE-GIT
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
notes:
  - kind: state
    text: >-
      Working memory (src/core/working.ts) also shells out to git: rev-parse for the anchor root
      (--git-common-dir, so worktrees share one folder) and a hardened ls-files trust check that
      refuses tracked or shipped .constellation/ files.
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

The change-tracking backbone; [[FILE-GIT]] shells out to it for diff / log / rev-list (revisions guarded by safeRev, with --end-of-options at most call sites).
