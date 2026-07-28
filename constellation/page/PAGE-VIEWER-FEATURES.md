---
name: Viewer — features panel
kind: route
status: built
code_refs:
  - viewer/src/pages/FeaturesPanel.svelte
---

The `#/features` route: a roadmap view of every FEATURE card, served by
[[FILE-SERVE]] alongside [[PAGE-VIEWER-HOME]]. Two sections — *Up next*
(`planned` / `building` / no status) on top, *Shipped* (`built` / `verified`)
below — each sorted by file mtime, freshest edit first. Rows link to the card
page and surface the feature's `release:` target (chip → the RELEASE card),
`branch:`, `pr:` (external link when it's a URL), and status pill.
