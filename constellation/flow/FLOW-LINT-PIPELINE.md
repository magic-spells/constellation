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
verified_at: '2026-10-04T22:03:30.324Z'
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
notes:
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

How a plan folder becomes validated graph state.

1. A consumer (CLI / MCP / viewer) calls `loadPlan(root)` — [[FILE-INDEXER]].
2. [[FILE-PARSE]] splits each file into frontmatter + body.
3. [[FILE-EXTRACT]] pulls every reference — frontmatter values (structural), `[[links]]` and mermaid IDs (hyperlinks); [[FILE-HANDLES]] validates handle shape and type.
4. The indexer dedupes handles, resolves references, builds the undirected connection set **from frontmatter only**, and collects E001–E006 / W001 / W004.
5. [[FILE-VALIDATE]] adds W002 / W003 from the JSON Schemas; [[FILE-LINT]] composes and sorts every issue.
6. The CLI exits 1 on errors, 0 otherwise (warnings never fail), 2 when no plan is found. See [[DOC-LINT-CODES]].
