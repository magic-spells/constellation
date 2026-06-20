---
name: scaffold.ts
status: built
path: src/core/scaffold.ts
language: typescript
summary: Shared init scaffold
connections:
  - FILE-CLI
  - FILE-MCP-SERVER
---

Creates `constellation/` + a starter `plan.md` (PLAN-PROJECT). Used by both CLI `init` and MCP `init_plan` so the two can't drift.
