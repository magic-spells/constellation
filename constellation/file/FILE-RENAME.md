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
---

Moves the card file to the new handle's path (folder follows the prefix) with its bytes
preserved, then rewrites every card that mentions the old handle — connections lists,
handle-shaped frontmatter values, `[[links]]`, mermaid node IDs, prose — as whole tokens
only (`API-USER` never touches `API-USERS`). Throws typed `RenameCardError`s
(NOT_FOUND / INVALID_HANDLE / CARD_EXISTS); callers map them to tool errors or exit codes.
