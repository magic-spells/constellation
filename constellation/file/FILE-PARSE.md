---
name: parse.ts
status: verified
path: src/core/parse.ts
language: typescript
summary: Split a card file into YAML frontmatter + markdown body
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
notes:
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

Frontmatter/body splitter built on gray-matter. Surfaces malformed YAML so the indexer can raise E006.
