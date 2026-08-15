---
name: SyncBadge
kind: ui
status: built
code_refs:
  - viewer/app/components/SyncBadge.pzl
---

Glanceable freshness badge — renders `computeSyncStatus` ([[FILE-SYNC]]) state (in-sync / drifted / dirty / never-synced), including the marker-unreachable case. Lives in the app-shell topbar and links to [[PAGE-VIEWER-HOME]]; built on the puzzle-pieces `badge` piece.
