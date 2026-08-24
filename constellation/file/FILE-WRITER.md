---
name: writer.ts
status: verified
path: src/core/writer.ts
language: typescript
summary: Byte-preserving card writes + patch / note / section helpers
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
verified_at: '2026-08-24T21:12:49.412Z'
---

Re-serializes only the top-level frontmatter keys whose values changed and keeps the body byte-for-byte on a frontmatter-only update (and vice versa). Provides deep-merge patch semantics, `withAppendedNote`, and fence-aware `replaceBodySection`. Shared by the MCP and viewer write paths — fix serialization bugs here once.

All writes are atomic (temp file + rename; exclusive creates via `link`) and serialized behind an in-process per-file lock (`withFileLock`). `mutateCardFile` is the locked read→transform→write path — the cheap writes apply their change to the file's *current* content, so concurrent small updates compose instead of clobbering. `rewriteHandleInFile` does the whole-token handle rewrite used by [[FILE-RENAME]].
