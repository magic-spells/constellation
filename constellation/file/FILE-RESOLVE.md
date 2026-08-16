---
name: resolve.ts
status: verified
path: src/core/resolve.ts
language: typescript
summary: Find the plan folder, bounded by the repo root
connections:
  - FILE-MCP-SERVER
verified_sha: b68341fab1d50f297248b83eccc2f936ad6b9234
verified_at: '2026-08-16T19:03:26.942Z'
---

Walks up from cwd to find `constellation/`, stopping at the first ancestor with `.git` and returning null rather than adopting a sibling repo's plan. Plan resolution never crosses a repo boundary.
