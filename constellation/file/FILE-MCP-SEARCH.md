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

Ranks matches: handle ≫ name > kind/type > body occurrences; excerpt is the first matching body line.
