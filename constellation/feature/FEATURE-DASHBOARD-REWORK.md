---
name: Overview dashboard rework
release: RELEASE-V0-5-0
change: feature
status: built
branch: feat/dashboard-rework
connections:
  - PAGE-VIEWER-HOME
  - COMPONENT-ICON
  - FILE-SERVE
---

# Overview dashboard rework

The first mission-control dashboard ([[FEATURE-OVERVIEW-DASHBOARD]]) shipped four panels that each answered a question, but the page as a whole did not read as a status board:

- **Drift said nothing, at length.** A plan with no sync marker and no `verified_sha` puts every claim card in `no_baseline` — 49 identical rows on this repo — while the panel that was supposed to deliver a verdict delivered a list.
- **Activity was split in two.** Plan commits sat in the sync panel, code commits in their own panel; the reader merged them by timestamp.
- **Release showed one release.** No history, and no way to say what was in one.
- **Browse tiles duplicated the sidebar**, and the stat row floated free of the verdict it qualified.

## Scope

- In: health strip (verdict + counts + **Set sync point**), release timeline grouped by a new FEATURE `change:` field, merged Activity panel, drift panel as a capped verdict with the untracked bucket as one line, an icon/tone vocabulary ([[COMPONENT-ICON]]), `POST /api/sync-point` on [[FILE-SERVE]].
- Out: a per-release changelog stored on the RELEASE card — release contents stay derived from the FEATURE cards pointing at it.

## Acceptance

- A never-synced plan reads "nothing tracked yet" plus one counted line naming the fix, not one row per claim.
- Stamping the sync point from the health strip gives every claim a baseline and the panel a real verdict, without a reload.
- Every release the plan knows about is listed, with Breaking called out on the header.
