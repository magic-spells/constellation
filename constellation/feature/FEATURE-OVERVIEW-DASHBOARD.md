---
name: Overview mission-control dashboard
release: RELEASE-V0-5-0
change: feature
status: verified
branch: feat/overview-dashboard
connections:
  - PAGE-VIEWER-HOME
  - FILE-SERVE
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
notes:
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

# Overview mission-control dashboard

Widen the Overview page and add four live panels: Drift (stale_report verdict),
Release (tag/package version + feature progress via `release:`), Code commits
(code-side activity feed), and Notes (latest `append_note` memory across cards).
All server data rides the existing `/api/sync` payload; Notes and Release
derive client-side from the store.

Reworked into a status board by [[FEATURE-DASHBOARD-REWORK]] later in the same
release — this card is the record of the first shape, not the current one.
