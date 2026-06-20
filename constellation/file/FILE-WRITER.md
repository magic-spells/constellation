---
name: writer.ts
status: built
path: src/core/writer.ts
language: typescript
summary: Byte-preserving card writes + patch / note / section helpers
---

Re-serializes only the top-level frontmatter keys whose values changed and keeps the body byte-for-byte on a frontmatter-only update (and vice versa). Provides deep-merge patch semantics, `withAppendedNote`, and fence-aware `replaceBodySection`. Shared by the MCP and viewer write paths — fix serialization bugs here once.
