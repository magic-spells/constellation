---
name: code.ts
status: built
path: src/core/code.ts
language: typescript
summary: Code binding + attach (same-repo, contained, capped)
---

Resolves a card's bound files — connected FILE `path:` + own `code_refs` — and attaches their contents under per-file (64 KB) and total (256 KB) caps, skipping binaries / lockfiles / generated and rejecting paths (incl. symlinks) that escape the repo root. A file over the per-file cap attaches its head with `truncated: true` rather than being skipped. Shared by `get_card` code mode, stale_report, and assemble.
