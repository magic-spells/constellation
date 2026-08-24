---
name: validate.ts
status: verified
path: src/core/validate.ts
language: typescript
summary: Ajv schema validation → W002 (shape) and W003 (unknown field)
connections:
  - FILE-TYPES
verified_sha: 2757d7de40f8f234c01bd7369c6fbfa85f23bcbb
verified_at: '2026-08-24T20:08:35.313Z'
---

Validates each card's frontmatter against `schemas/`. Derives the W003 base allow-list from `card.json`'s properties (not a hardcoded list), so cross-type metadata fields are blessed on all 21 types. W003 answers its own question: the message lists the type's own fields and the cross-type keys as two groups and suggests a near-miss (separator-insensitive edit distance, budget scaled to name length), so a typo costs no `describe_type` round-trip; the reserved four stay suggestion candidates but are not listed. Ajv ships CJS — loaded via createRequire.
