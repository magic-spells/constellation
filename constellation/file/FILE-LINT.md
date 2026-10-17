---
name: lint.ts
status: verified
path: src/core/lint.ts
language: typescript
summary: 'lintPlan: loadPlan + schema validation, sorted'
connections:
  - FILE-VALIDATE
  - FILE-CLI
verified_at: '2026-10-04T22:03:30.324Z'
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
notes:
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

Composes the indexer's structural issues with schema validation, sorted by file then code. Errors break the graph (CLI exit 1); warnings never fail.
