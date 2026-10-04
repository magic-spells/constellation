---
name: StatusSelect
kind: ui
status: verified
code_refs:
  - viewer/app/components/StatusSelect.pzl
connections:
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

Card status picker (`planned` → `building` → `built` → `verified`, plus *none*); PATCHes through the write API ([[FILE-SERVE]]). Built on the puzzle-pieces `select` piece.
