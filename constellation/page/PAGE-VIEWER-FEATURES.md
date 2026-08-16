---
name: Viewer — features panel
kind: route
status: verified
code_refs:
  - viewer/app/views/FeaturesPanel.pzl
connections:
  - FILE-SERVE
verified_sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
verified_at: '2026-08-16T02:33:46.258Z'
---

The `#/features` route: a roadmap view of every FEATURE card, served by
[[FILE-SERVE]] alongside [[PAGE-VIEWER-HOME]]. Two sections — *Up next*
(`planned` / `building` / no status) on top, *Shipped* (`built` / `verified`)
below — each sorted by file mtime, freshest edit first. Rows link to the card
page and surface the feature's `release:` target (chip → the RELEASE card),
`branch:`, `pr:` (external link when it's a URL), and status pill.
