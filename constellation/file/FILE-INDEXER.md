---
name: indexer.ts
status: verified
path: src/core/indexer.ts
language: typescript
summary: 'loadPlan(root): the heart of the system'
connections:
  - FILE-TYPES
  - FILE-PARSE
  - FILE-EXTRACT
  - FILE-HANDLES
  - FILE-LINT
  - FILE-MCP-SERVER
  - FILE-SERVE
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
notes:
  - kind: state
    text: >-
      structuredReferrers(index, handle) lists cards whose connections: or handle-shaped frontmatter
      still names that handle — leftover E005s after delete. Not the undirected neighbor set.
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

Reads every card, dedupes handles, resolves references, builds the undirected connection set, and collects structural issues (E001–E006, W001, W004). The single source of the derived graph — recomputed on every load, never stored.

`buildConnections` unions **frontmatter only** — the `connections:` list plus handle-shaped values in other frontmatter fields. `[[link]]` and mermaid refs are still extracted and still linted (W004), but never become edges: a prose mention is a link, not a connection. One edge declared from both sides still yields one `{a, b}` pair, and the index exposes `connectedHandles` (read through `neighborsOf(index, handle)`). Lint is decided per reference in `resolveRefs`, over refs that never become an edge.
