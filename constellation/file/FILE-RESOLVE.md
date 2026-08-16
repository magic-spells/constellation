---
name: resolve.ts
status: built
path: src/core/resolve.ts
language: typescript
summary: Find the plan folder, bounded by the repo root
connections:
  - FILE-MCP-SERVER
verified_sha: d5c77f0d44725ae7ab3236c191caef3c3332016c
verified_at: '2026-08-16T00:47:22.586Z'
---

Walks up from cwd to find `constellation/`, stopping at the first ancestor with `.git` and returning null rather than adopting a sibling repo's plan. Plan resolution never crosses a repo boundary.
