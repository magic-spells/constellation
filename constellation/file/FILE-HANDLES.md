---
name: handles.ts
status: verified
path: src/core/handles.ts
language: typescript
summary: Handle grammar, the 21 canonical prefixes, and the type↔folder map
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
notes:
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

Defines the handle regex (`^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$`), `isHandleShaped` / `isKnownHandle` / `typeForHandle`, and `TYPE_FOLDERS` — the authority for which prefix is which type and where its cards live.
