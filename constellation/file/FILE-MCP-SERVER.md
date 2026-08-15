---
name: mcp/server.ts
status: built
path: src/mcp/server.ts
language: typescript
summary: 'The MCP server: tools + INSTRUCTIONS'
---

`constellation mcp` (stdio). Registers every tool, embeds the agent-facing `INSTRUCTIONS` string (one of the three guidance copies), and resolves the target plan — the home plan or, when `repo` is passed, a connected sibling. The server handshake version is the package version (same source as the CLI), not a hardcoded leftover.

`delete_card` refuses `PLAN-PROJECT` (`plan.md` is the plan root). `set_verified`'s dirty-tree warning uses the same directory-overlap rule as [[FILE-STALE]] — a bound folder lights up when a file under it is uncommitted. `assemble` units treat a folder binding as overlapping every path inside it, so fan-out cannot hand the same files to two agents.
