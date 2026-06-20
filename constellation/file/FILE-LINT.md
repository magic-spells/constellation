---
name: lint.ts
status: built
path: src/core/lint.ts
language: typescript
summary: 'lintPlan: loadPlan + schema validation, sorted'
---

Composes the indexer's structural issues with schema validation, sorted by file then code. Errors break the graph (CLI exit 1); warnings never fail.
