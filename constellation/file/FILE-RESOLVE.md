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
notes:
  - kind: state
    text: >-
      Gained downward discovery: findRepoRoot(startDir) extracted from findPlanUp's .git stop;
      discoverPlans(scanRoot, {maxDepth=3}) BFS accepting only dirs with constellation/plan.md,
      skipping node_modules/dot-dirs/dist/build/out/coverage/target/vendor/tmp/constellation-dirs
      and any dir containing .git (nested repo — downward mirror of the upward stop), descending
      past dirs that have plans. Assigns stable ids (root reserved for the repo-root plan; slug
      basename when unique; dashed relative path otherwise, always accepted as alias) with -2/-3
      dedupe, once at startup. findPlanUp/resolvePlanDir unchanged.
---

Walks up from cwd to find `constellation/`, stopping at the first ancestor with `.git` and returning null rather than adopting a sibling repo's plan. Plan resolution never crosses a repo boundary.
