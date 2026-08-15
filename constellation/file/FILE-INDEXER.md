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

Every connection carries its **provenance**: `sources: ["structured"]` (a `connections:` entry or a handle-shaped frontmatter value — a contract) and/or `["prose"]` (a `[[link]]` or a mermaid node ID — aspirational). One edge declared both ways keeps both sources, and the index exposes the adjacency three ways — `connectedHandles` (union), `structuredHandles`, `proseHandles` — read through `neighborsOf(index, handle, edges)`. Provenance is for *walking*, not for lint: E005 vs W004 is still decided per reference in `resolveRefs`.
