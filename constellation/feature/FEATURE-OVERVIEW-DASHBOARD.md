---
name: Overview mission-control dashboard
release: RELEASE-V0-5-0
status: built
branch: feat/overview-dashboard
connections:
  - PAGE-VIEWER-HOME
  - FILE-SERVE
---

# Overview mission-control dashboard

Widen the Overview page and add four live panels: Drift (stale_report verdict),
Release (tag/package version + feature progress via `release:`), Code commits
(code-side activity feed), and Notes (latest `append_note` memory across cards).
All server data rides the existing `/api/sync` payload; Notes and Release
derive client-side from the store.
