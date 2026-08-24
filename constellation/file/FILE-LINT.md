---
name: lint.ts
status: verified
path: src/core/lint.ts
language: typescript
summary: 'lintPlan: loadPlan + schema validation, sorted'
connections:
  - FILE-VALIDATE
  - FILE-CLI
verified_at: '2026-08-24T21:11:34.373Z'
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
---

Composes the indexer's structural issues with schema validation, sorted by file then code. Errors break the graph (CLI exit 1); warnings never fail.
