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
---

A single card at `#/card/<HANDLE>`: frontmatter fields, rendered markdown + mermaid body, connection chips in both directions, the derived neighborhood diagram, and inline editing of the name, status, frontmatter fields and connections via [[COMPONENT-EDITABLE]] / [[COMPONENT-STATUS-SELECT]]. Served by [[FILE-SERVE]]; every edit affordance is gated on the plan's `editable` flag (`serve --readonly` hides them all).
