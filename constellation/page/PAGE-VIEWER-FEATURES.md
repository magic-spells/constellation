---
name: Viewer — features panel
kind: route
status: verified
code_refs:
  - viewer/app/views/FeaturesPanel.pzl
connections:
  - FILE-SERVE
verified_sha: dbaa7fc23fb5a41ce5672978f990c3080c3e5f3a
verified_at: '2026-08-16T18:26:03.498Z'
notes:
  - kind: verified
    text: >-
      Route moved to #/tasks/list and the card records that this is the List tab of Tasks. The
      centred 62rem container moved onto the content rows so the shared tab strip stays anchored
      across a switch.
    sha: dbaa7fc23fb5a41ce5672978f990c3080c3e5f3a
---

The `#/tasks/list` route: a roadmap view of every FEATURE card, served by
[[FILE-SERVE]] alongside [[PAGE-VIEWER-HOME]]. Two sections — *Up next*
(`planned` / `building` / no status) on top, *Shipped* (`built` / `verified`)
below — each sorted by file mtime, freshest edit first. Rows link to the card
page and surface the feature's `release:` target (chip → the RELEASE card),
`branch:`, `pr:` (external link when it's a URL), and status pill.

**The List tab of Tasks.** Since 0.5.1 this is not its own destination: it and
[[PAGE-VIEWER-BOARD]] show the same FEATURE cards and differ only in the reading,
so they sit behind one **Tasks** sidebar row as two tabs sharing a heading and
strip (`components/TasksHeader.pzl`). Its container matches the board's exactly —
left-aligned, same padding — so the strip stays anchored when you switch; the row
width is capped on the CONTENT instead, because a feature row stretched across a
wide display is unreadable. `#/features` still resolves as a redirect.
