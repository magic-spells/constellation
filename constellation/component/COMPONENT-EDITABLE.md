---
name: Editable
kind: ui
status: built
code_refs:
  - viewer/src/components/Editable.svelte
---

Inline-edit wrapper: click to edit a field or the body, saves through the serve PATCH endpoint with an `if_mtime` stale-write guard ([[FILE-SERVE]]).
