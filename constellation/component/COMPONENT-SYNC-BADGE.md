---
name: SyncBadge
kind: ui
status: verified
code_refs:
  - viewer/app/components/SyncBadge.pzl
connections:
  - FILE-SYNC
  - PAGE-VIEWER-HOME
verified_at: '2026-10-05T00:02:43.606Z'
verified_sha: 3ad1a1ec1e242169a4743bd17cc36b22e58b9a6c
notes:
  - kind: verified
    text: >-
      Re-checked after viewer i18n (#46), the Observatory dark retune (bbbf885) and the header
      language globe (e2004a4); card fixes in f457fd1 and 3ad1a1e.
    sha: 3ad1a1ec1e242169a4743bd17cc36b22e58b9a6c
---

Glanceable freshness badge — renders `computeSyncStatus` ([[FILE-SYNC]]) state (in-sync / drifted / dirty / never-synced), including the marker-unreachable case. Lives in the app-shell topbar and links to [[PAGE-VIEWER-HOME]]; built on the puzzle-pieces `badge` piece. Glyph and label come from `SYNC_META` / `syncLabel` in `lib/format.js`, shared with the Overview. The badge is capped at `max-w-full` and its label and detail truncate, so a long translation shortens instead of pushing the header ([[FEATURE-VIEWER-I18N]]).
