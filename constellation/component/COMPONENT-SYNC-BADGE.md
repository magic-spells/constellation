---
name: SyncBadge
kind: ui
status: verified
code_refs:
  - viewer/app/components/SyncBadge.pzl
connections:
  - FILE-SYNC
  - PAGE-VIEWER-HOME
verified_at: '2026-08-24T21:11:01.333Z'
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
---

Glanceable freshness badge — renders `computeSyncStatus` ([[FILE-SYNC]]) state (in-sync / drifted / dirty / never-synced), including the marker-unreachable case. Lives in the app-shell topbar and links to [[PAGE-VIEWER-HOME]]; built on the puzzle-pieces `badge` piece.
