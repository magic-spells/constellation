---
name: Lint codes
kind: reference
status: verified
connections:
  - FILE-INDEXER
  - FILE-VALIDATE
  - FILE-LINT
section: format
order: 30
verified_at: '2026-08-24T20:08:43.123Z'
verified_sha: 2757d7de40f8f234c01bd7369c6fbfa85f23bcbb
---

# Lint codes

Errors break the graph (CLI exit 1; CI should block). Warnings are quality signals (exit 0).
Structural codes come from [[FILE-INDEXER]]; schema codes (W002/W003) from [[FILE-VALIDATE]];
[[FILE-LINT]] composes and sorts them.

**Errors**

| Code | Rule |
|---|---|
| E001 | Filename is not a valid handle |
| E002 | Handle prefix is not one of the 21 canonical prefixes |
| E003 | Duplicate handle (two files resolve to the same handle) |
| E004 | `connections` entry is not a handle-shaped string |
| E005 | `connections` or frontmatter-field target resolves to no card |
| E006 | Frontmatter is not valid YAML |

**Warnings**

| Code | Rule |
|---|---|
| W001 | Card is not in the folder matching its type |
| W002 | Frontmatter violates the type's JSON Schema |
| W003 | Unknown frontmatter field (not a reserved/cross-type key from card.json, not in the type schema) — the message names the type's valid fields and suggests a near-miss |
| W004 | Body `[[link]]` or mermaid reference resolves to no card |

The E005/W004 split is deliberate: **structured references are contracts** (a frontmatter
target must resolve → error); **prose references are aspirational** (a body `[[link]]` may
point at a card not yet written → warning). W004 is a dead-link warning only — a prose mention
is a link, never a connection (see [[DOC-FILE-FORMAT]]), so it says nothing about connectivity.
