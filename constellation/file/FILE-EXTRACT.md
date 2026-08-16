---
name: extract.ts
status: built
path: src/core/extract.ts
language: typescript
summary: Pull references out of a card body and frontmatter
---

Extracts a card's references: handle-shaped frontmatter values (which build the graph), plus `[[HANDLE]]` wiki-links and mermaid node IDs (hyperlinks, linted but never edges — see [[FILE-INDEXER]]). Only handle-shaped tokens count.
