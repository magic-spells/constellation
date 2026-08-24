---
name: resolve.ts
status: verified
path: src/core/resolve.ts
language: typescript
summary: Find the plan folder, bounded by the repo root
connections:
  - FILE-MCP-SERVER
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
verified_at: '2026-08-24T21:10:24.754Z'
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

It also resolves plans **downward**, which is what multi-plan serve stands on: `discoverPlans` runs a bounded BFS from a scan root for every `constellation/plan.md`, and `identifyPlans` gives each one a stable route id. The downward walk mirrors the upward stop — a directory containing `.git` is a nested repo and is skipped — so discovery never crosses a repo boundary either. Discovery is deliberately one-shot: a plan created while the server is running needs a restart to appear.
