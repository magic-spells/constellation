---
name: indexer.ts
status: built
path: src/core/indexer.ts
language: typescript
summary: 'loadPlan(root): the heart of the system'
connections:
  - FILE-TYPES
---

Reads every card, dedupes handles, resolves references, builds the undirected connection set, and collects structural issues (E001–E006, W001, W004). The single source of the derived graph — recomputed on every load, never stored.

`buildConnections` unions **frontmatter only** — the `connections:` list plus handle-shaped values in other frontmatter fields. `[[link]]` and mermaid refs are still extracted and still linted (W004), but never become edges: a prose mention is a link, not a connection. One edge declared from both sides still yields one `{a, b}` pair, and the index exposes `connectedHandles` (read through `neighborsOf(index, handle)`). Lint is decided per reference in `resolveRefs`, over refs that never become an edge.
