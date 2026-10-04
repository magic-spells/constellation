---
name: resolve.ts
status: verified
path: src/core/resolve.ts
language: typescript
summary: Find the plan folder, bounded by the repo root
connections:
  - FILE-MCP-SERVER
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
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
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

Walks up from cwd to find `constellation/`, stopping at the first ancestor with `.git` and returning null rather than adopting a sibling repo's plan. Plan resolution never crosses a repo boundary.

It also resolves plans **downward**, which is what multi-plan serve stands on: `discoverPlans` runs a bounded BFS from a scan root for every `constellation/plan.md`, and `identifyPlans` gives each one a stable route id. The downward walk mirrors the upward stop — a directory containing `.git` is a nested repo and is skipped — so discovery never crosses a repo boundary either. Discovery is deliberately one-shot: a plan created while the server is running needs a restart to appear.
