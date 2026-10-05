---
name: Editable
kind: ui
status: verified
code_refs:
  - viewer/app/components/Editable.pzl
connections:
  - FILE-SERVE
verified_sha: 3ad1a1ec1e242169a4743bd17cc36b22e58b9a6c
verified_at: '2026-10-05T00:02:43.606Z'
notes:
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
  - kind: verified
    text: >-
      Re-checked after viewer i18n (#46), the Observatory dark retune (bbbf885) and the header
      language globe (e2004a4); card fixes in f457fd1 and 3ad1a1e.
    sha: 3ad1a1ec1e242169a4743bd17cc36b22e58b9a6c
---

Inline-edit wrapper: click to edit a field or the body, saves through the serve PATCH endpoint with an `if_mtime` stale-write guard ([[FILE-SERVE]]). Edit-buffer semantics (⌘↩ saves, Esc cancels) — it declares its own `@input` handler so Puzzle's two-way form binding is not synthesized over the draft.
