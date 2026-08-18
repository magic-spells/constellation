---
name: Editable
kind: ui
status: verified
code_refs:
  - viewer/app/components/Editable.pzl
connections:
  - FILE-SERVE
verified_sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
verified_at: '2026-08-18T17:56:52.202Z'
---

Inline-edit wrapper: click to edit a field or the body, saves through the serve PATCH endpoint with an `if_mtime` stale-write guard ([[FILE-SERVE]]). Edit-buffer semantics (⌘↩ saves, Esc cancels) — it declares its own `@input` handler so Puzzle's two-way form binding is not synthesized over the draft.
