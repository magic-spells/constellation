---
name: Code style rules
status: built
scope: src/**
applies_to: all-agents
priority: 1
---

# Code style

- TypeScript strict mode; no `any` without a comment explaining why.
- Route handlers validate input with the shapes from [[DATATYPE-TICKET]] and
  [[DATATYPE-CREATE-TICKET-INPUT]] — never hand-rolled checks.
- Errors return the shared envelope `{ error: { code, message } }`.
