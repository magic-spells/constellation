---
name: Sync the plan to the code
kind: sync
status: verified
connections:
  - FILE-GIT
  - DOC-CHANGE-TRACKING
verified_sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
verified_at: '2026-08-16T02:33:32.749Z'
---

"Sync the plan to the code" brings CODE up to a changed plan — the plan is the source of truth, so behavior changes in the plan first.

1. `diff_plan` (base = the `.sync.json` marker) lists added / modified / removed cards — [[FILE-GIT]].
2. `traverse` the changed handles (detail: full) for the blast radius.
3. Update the application code to match those cards.
4. Run the build/tests, bump card `status`, commit the plan.
5. `set_sync_point` advances the marker. For a large diff, `assemble` partitions the blast radius into file-disjoint units to fan out one sub-agent each. See [[DOC-CHANGE-TRACKING]].
