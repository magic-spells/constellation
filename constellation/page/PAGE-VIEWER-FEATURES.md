---
name: Viewer — features panel
kind: route
status: built
code_refs:
  - viewer/app/views/FeaturesPanel.pzl
connections:
  - FILE-SERVE
verified_sha: d5c77f0d44725ae7ab3236c191caef3c3332016c
verified_at: '2026-08-16T00:47:22.586Z'
---

The `#/features` route: a roadmap view of every FEATURE card, served by
[[FILE-SERVE]] alongside [[PAGE-VIEWER-HOME]]. Two sections — *Up next*
(`planned` / `building` / no status) on top, *Shipped* (`built` / `verified`)
below — each sorted by file mtime, freshest edit first. Rows link to the card
page and surface the feature's `release:` target (chip → the RELEASE card),
`branch:`, `pr:` (external link when it's a URL), and status pill.
