---
name: Sync the plan to the code
kind: sync
status: verified
connections:
  - FILE-GIT
  - DOC-CHANGE-TRACKING
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
section: plan-and-code
order: 20
notes:
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

"Sync the plan to the code" brings CODE up to a changed plan — the plan is the source of truth, so behavior changes in the plan first.

1. `diff_plan` (base = the `.sync.json` marker) lists added / modified / removed cards — [[FILE-GIT]].
2. `traverse` the changed handles (detail: full) for the blast radius.
3. Update the application code to match those cards.
4. Run the build/tests, bump card `status`, commit the plan.
5. `set_sync_point` advances the marker. For a large diff, `assemble` partitions the blast radius into file-disjoint units to fan out one sub-agent each. See [[DOC-CHANGE-TRACKING]].
