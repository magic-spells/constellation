---
name: Lint codes
kind: reference
status: built
---

# Lint codes

Errors break the graph (CLI exit 1; CI should block). Warnings are quality signals (exit 0).
Structural codes come from [[FILE-INDEXER]]; schema codes (W002/W003) from [[FILE-VALIDATE]];
[[FILE-LINT]] composes and sorts them.

**Errors**

| Code | Rule |
|---|---|
| E001 | Filename is not a valid handle |
| E002 | Handle prefix is not one of the 17 canonical prefixes |
| E003 | Duplicate handle (two files resolve to the same handle) |
| E004 | `connections` entry is not a handle-shaped string |
| E005 | `connections` or frontmatter-field target resolves to no card |
| E006 | Frontmatter is not valid YAML |

**Warnings**

| Code | Rule |
|---|---|
| W001 | Card is not in the folder matching its type |
| W002 | Frontmatter violates the type's JSON Schema |
| W003 | Unknown frontmatter field (not a reserved/cross-type key from card.json, not in the type schema) |
| W004 | Body `[[link]]` or mermaid reference resolves to no card |

The E005/W004 split is deliberate: **structured references are contracts** (a frontmatter
target must resolve → error); **prose references are aspirational** (a body `[[link]]` may
point at a card not yet written → warning).
