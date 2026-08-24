---
name: StatusSelect
kind: ui
status: verified
code_refs:
  - viewer/app/components/StatusSelect.pzl
connections:
  - FILE-SERVE
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
verified_at: '2026-08-24T21:11:19.367Z'
---

Card status picker (`planned` → `building` → `built` → `verified`, plus *none*); PATCHes through the write API ([[FILE-SERVE]]). Built on the puzzle-pieces `select` piece.
