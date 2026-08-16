---
name: StatusSelect
kind: ui
status: verified
code_refs:
  - viewer/app/components/StatusSelect.pzl
connections:
  - FILE-SERVE
verified_sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
verified_at: '2026-08-16T02:32:32.445Z'
---

Card status picker (`planned` → `building` → `built` → `verified`, plus *none*); PATCHes through the write API ([[FILE-SERVE]]). Built on the puzzle-pieces `select` piece.
