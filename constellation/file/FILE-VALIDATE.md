---
name: validate.ts
status: built
path: src/core/validate.ts
language: typescript
summary: Ajv schema validation → W002 (shape) and W003 (unknown field)
connections:
  - FILE-TYPES
---

Validates each card's frontmatter against `schemas/`. Derives the W003 base allow-list from `card.json`'s properties (not a hardcoded list), so cross-type metadata fields are blessed on all 17 types. Ajv ships CJS — loaded via createRequire.
