---
name: writer.ts
status: verified
path: src/core/writer.ts
language: typescript
summary: Byte-preserving card writes + patch / note / section helpers
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
notes:
  - kind: state
    text: >-
      if_mtime is compared to the file mtime inside withFileLock (mutateCardFile opts), so two
      callers who both sampled T cannot both write — StaleWriteError. deleteCardFile rms under the
      same lock so a concurrent mutate cannot resurrect the file.
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

Re-serializes only the top-level frontmatter keys whose values changed and keeps the body byte-for-byte on a frontmatter-only update (and vice versa). Provides deep-merge patch semantics, `withAppendedNote`, and fence-aware `replaceBodySection`. Shared by the MCP and viewer write paths — fix serialization bugs here once.

All writes are atomic (temp file + rename; exclusive creates via `link`) and serialized behind an in-process per-file lock (`withFileLock`). The rename retries with backoff on `EPERM`/`EBUSY`/`EACCES`, since an editor or virus scanner can briefly hold the target, routinely on Windows. `writeAtomic` is exported, and [[FILE-GIT]]'s sync marker and working memory use it too. A create refuses to write through a symlinked type folder whose real path leaves the plan (`PathEscapeError`). `mutateCardFile` is the locked read→transform→write path — the cheap writes apply their change to the file's *current* content, so concurrent small updates compose instead of clobbering. `rewriteHandleInFile` does the whole-token handle rewrite used by [[FILE-RENAME]].
