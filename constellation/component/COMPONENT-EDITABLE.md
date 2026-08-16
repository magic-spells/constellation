---
name: Editable
kind: ui
status: verified
code_refs:
  - viewer/app/components/Editable.pzl
connections:
  - FILE-SERVE
verified_sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
verified_at: '2026-08-16T02:32:27.205Z'
---

Inline-edit wrapper: click to edit a field or the body, saves through the serve PATCH endpoint with an `if_mtime` stale-write guard ([[FILE-SERVE]]). Edit-buffer semantics (⌘↩ saves, Esc cancels) — it declares its own `@input` handler so Puzzle's two-way form binding is not synthesized over the draft.
