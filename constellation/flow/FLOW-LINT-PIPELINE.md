---
name: Lint pipeline
kind: pipeline
status: verified
connections:
  - FILE-INDEXER
  - FILE-VALIDATE
  - FILE-LINT
  - DOC-LINT-CODES
section: plan-and-code
order: 40
verified_at: '2026-08-24T21:11:33.167Z'
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
---

How a plan folder becomes validated graph state.

1. A consumer (CLI / MCP / viewer) calls `loadPlan(root)` — [[FILE-INDEXER]].
2. [[FILE-PARSE]] splits each file into frontmatter + body.
3. [[FILE-EXTRACT]] pulls every reference — frontmatter values (structural), `[[links]]` and mermaid IDs (hyperlinks); [[FILE-HANDLES]] validates handle shape and type.
4. The indexer dedupes handles, resolves references, builds the undirected connection set **from frontmatter only**, and collects E001–E006 / W001 / W004.
5. [[FILE-VALIDATE]] adds W002 / W003 from the JSON Schemas; [[FILE-LINT]] composes and sorts every issue.
6. The CLI exits 1 on errors, 0 otherwise (warnings never fail), 2 when no plan is found. See [[DOC-LINT-CODES]].
