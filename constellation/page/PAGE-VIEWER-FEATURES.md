---
name: Viewer — features panel
kind: route
status: verified
code_refs:
  - viewer/app/views/FeaturesPanel.pzl
connections:
  - FILE-SERVE
verified_sha: 3ad1a1ec1e242169a4743bd17cc36b22e58b9a6c
verified_at: '2026-10-05T00:02:43.606Z'
notes:
  - kind: verified
    text: >-
      Route moved to #/tasks/list and the card records that this is the List tab of Tasks. The
      centred 62rem container moved onto the content rows so the shared tab strip stays anchored
      across a switch.
    sha: dbaa7fc23fb5a41ce5672978f990c3080c3e5f3a
  - kind: verified
    text: >-
      Only change since the last stamp is the dropped star glyph and its orphaned .feat-title rules
      — the heading moved to TasksHeader when the views merged. Nothing this card claims changed.
    sha: ee8384873bdb280e2f7c9b6cf6790bb217af19f7
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
  - kind: verified
    text: >-
      Re-checked after viewer i18n (#46), the Observatory dark retune (bbbf885) and the header
      language globe (e2004a4); card fixes in f457fd1 and 3ad1a1e.
    sha: 3ad1a1ec1e242169a4743bd17cc36b22e58b9a6c
section: viewer
order: 30
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
