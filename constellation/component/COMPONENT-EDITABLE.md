---
name: Editable
kind: ui
status: verified
code_refs:
  - viewer/app/components/Editable.pzl
connections:
  - FILE-SERVE
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
verified_at: '2026-08-24T21:11:18.450Z'
---

Inline-edit wrapper: click to edit a field or the body, saves through the serve PATCH endpoint with an `if_mtime` stale-write guard ([[FILE-SERVE]]). Edit-buffer semantics (⌘↩ saves, Esc cancels) — it declares its own `@input` handler so Puzzle's two-way form binding is not synthesized over the draft.
