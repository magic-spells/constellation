---
name: resolve.ts
status: built
path: src/core/resolve.ts
language: typescript
summary: Find the plan folder, bounded by the repo root
---

Walks up from cwd to find `constellation/`, stopping at the first ancestor with `.git` and returning null rather than adopting a sibling repo's plan. Plan resolution never crosses a repo boundary.
