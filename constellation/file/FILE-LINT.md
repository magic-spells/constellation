---
name: lint.ts
status: verified
path: src/core/lint.ts
language: typescript
summary: 'lintPlan: loadPlan + schema validation, sorted'
connections:
  - FILE-VALIDATE
  - FILE-CLI
verified_at: '2026-08-16T19:03:14.598Z'
verified_sha: b68341fab1d50f297248b83eccc2f936ad6b9234
---

Composes the indexer's structural issues with schema validation, sorted by file then code. Errors break the graph (CLI exit 1); warnings never fail.
