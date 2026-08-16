---
name: rename.ts
status: built
path: src/core/rename.ts
language: typescript
summary: Plan-wide handle rename shared by MCP rename_card and CLI rename
connections:
  - FILE-WRITER
  - FILE-INDEXER
  - FILE-MCP-SERVER
  - FILE-CLI
verified_sha: d5c77f0d44725ae7ab3236c191caef3c3332016c
verified_at: '2026-08-16T00:47:22.586Z'
---

Moves the card file to the new handle's path (folder follows the prefix) with its bytes
preserved, then rewrites every card that mentions the old handle — connections lists,
handle-shaped frontmatter values, `[[links]]`, mermaid node IDs, prose — as whole tokens
only (`API-USER` never touches `API-USERS`). Throws typed `RenameCardError`s
(NOT_FOUND / INVALID_HANDLE / CARD_EXISTS); callers map them to tool errors or exit codes.
