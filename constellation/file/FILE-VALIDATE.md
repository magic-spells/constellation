---
name: validate.ts
status: built
path: src/core/validate.ts
language: typescript
summary: Ajv schema validation → W002 (shape) and W003 (unknown field)
connections:
  - FILE-TYPES
verified_sha: d5c77f0d44725ae7ab3236c191caef3c3332016c
verified_at: '2026-08-16T00:47:22.586Z'
---

Validates each card's frontmatter against `schemas/`. Derives the W003 base allow-list from `card.json`'s properties (not a hardcoded list), so cross-type metadata fields are blessed on all 21 types. Ajv ships CJS — loaded via createRequire.
