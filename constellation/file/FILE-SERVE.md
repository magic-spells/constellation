---
name: serve/server.ts
status: built
path: src/serve/server.ts
language: typescript
summary: Local HTTP server for the viewer
---

Serves `viewer/dist`, a read API, and a PATCH/POST/DELETE write API (with `if_mtime` stale-write guard), watching files for live reload. Shares the byte-preserving writer with the MCP path.
