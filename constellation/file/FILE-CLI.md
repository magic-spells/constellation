---
name: cli/index.ts
status: built
path: src/cli/index.ts
language: typescript
summary: The constellation binary (commander)
---

Commands: `init`, `lint`, `rename`, `mcp`, `serve`, `repos`, `version`/`v`, `upgrade`. `lint` exits 1 on errors, 0 otherwise (warnings never fail), 2 when no plan is found. `rename OLD NEW` is the human-facing wrapper over [[FILE-RENAME]] — it prints the rewritten references and a lint-error count.
