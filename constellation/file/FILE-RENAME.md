---
name: rename.ts
status: verified
path: src/core/rename.ts
language: typescript
summary: Plan-wide handle rename shared by MCP rename_card and CLI rename
connections:
  - FILE-WRITER
  - FILE-INDEXER
  - FILE-MCP-SERVER
  - FILE-CLI
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
notes:
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

Moves the card file to the new handle's path (folder follows the prefix) with its bytes
preserved, then rewrites every card that mentions the old handle — connections lists,
handle-shaped frontmatter values, `[[links]]`, mermaid node IDs, prose — as whole tokens
only (`API-USER` never touches `API-USERS`). Throws typed `RenameCardError`s
(NOT_FOUND / INVALID_HANDLE / CARD_EXISTS); callers map them to tool errors or exit codes.
