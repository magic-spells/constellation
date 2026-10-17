---
name: extract.ts
status: verified
path: src/core/extract.ts
language: typescript
summary: Pull references out of a card body and frontmatter
verified_at: '2026-10-04T22:03:30.324Z'
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
notes:
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

Extracts a card's references: handle-shaped frontmatter values (which build the graph), plus `[[HANDLE]]` wiki-links and mermaid node IDs (hyperlinks, linted but never edges — see [[FILE-INDEXER]]). Only handle-shaped tokens count.
