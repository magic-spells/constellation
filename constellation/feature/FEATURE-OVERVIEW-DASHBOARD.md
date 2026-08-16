---
name: Overview mission-control dashboard
release: RELEASE-V0-5-0
change: feature
status: built
branch: feat/overview-dashboard
connections:
  - PAGE-VIEWER-HOME
  - FILE-SERVE
verified_sha: d5c77f0d44725ae7ab3236c191caef3c3332016c
verified_at: '2026-08-16T00:47:22.586Z'
---

# Overview mission-control dashboard

Widen the Overview page and add four live panels: Drift (stale_report verdict),
Release (tag/package version + feature progress via `release:`), Code commits
(code-side activity feed), and Notes (latest `append_note` memory across cards).
All server data rides the existing `/api/sync` payload; Notes and Release
derive client-side from the store.

Reworked into a status board by [[FEATURE-DASHBOARD-REWORK]] later in the same
release — this card is the record of the first shape, not the current one.
