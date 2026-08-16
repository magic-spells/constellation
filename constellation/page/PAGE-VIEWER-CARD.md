---
name: Viewer — card
kind: route
status: built
code_refs:
  - viewer/app/views/CardPage.pzl
connections:
  - FILE-SERVE
  - COMPONENT-EDITABLE
  - COMPONENT-STATUS-SELECT
verified_sha: d5c77f0d44725ae7ab3236c191caef3c3332016c
verified_at: '2026-08-16T00:47:22.586Z'
---

A single card at `#/card/<HANDLE>`: frontmatter fields, rendered markdown + mermaid body, connection chips in both directions (no neighborhood diagram — it duplicated the chips), and inline editing of the name, status, frontmatter fields and connections via [[COMPONENT-EDITABLE]] / [[COMPONENT-STATUS-SELECT]]. Served by [[FILE-SERVE]]; every edit affordance is gated on the plan's `editable` flag (`serve --readonly` hides them all).
