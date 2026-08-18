---
name: StatusSelect
kind: ui
status: verified
code_refs:
  - viewer/app/components/StatusSelect.pzl
connections:
  - FILE-SERVE
verified_sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
verified_at: '2026-08-18T17:56:52.265Z'
---

Card status picker (`planned` → `building` → `built` → `verified`, plus *none*); PATCHes through the write API ([[FILE-SERVE]]). Built on the puzzle-pieces `select` piece.
