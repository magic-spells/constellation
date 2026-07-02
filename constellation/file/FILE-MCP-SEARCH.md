---
name: mcp/search.ts
status: built
path: src/mcp/search.ts
language: typescript
summary: Scored full-text search
connections:
  - FILE-MCP-SERVER
  - DOC-MCP-SERVER
---

Ranks matches: handle ≫ name > kind/type > body-and-note occurrences; appended notes are indexed as `note(kind): text` lines so recorded memory stays findable, and the excerpt is the first matching body or note line.
