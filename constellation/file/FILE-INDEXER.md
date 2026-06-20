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
