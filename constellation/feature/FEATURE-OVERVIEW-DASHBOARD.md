---
name: Overview mission-control dashboard
release: RELEASE-V0-5-0
change: feature
status: verified
branch: feat/overview-dashboard
connections:
  - PAGE-VIEWER-HOME
  - FILE-SERVE
verified_sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
verified_at: '2026-08-18T17:56:52.646Z'
---

# Overview mission-control dashboard

Widen the Overview page and add four live panels: Drift (stale_report verdict),
Release (tag/package version + feature progress via `release:`), Code commits
(code-side activity feed), and Notes (latest `append_note` memory across cards).
All server data rides the existing `/api/sync` payload; Notes and Release
derive client-side from the store.

Reworked into a status board by [[FEATURE-DASHBOARD-REWORK]] later in the same
release — this card is the record of the first shape, not the current one.
