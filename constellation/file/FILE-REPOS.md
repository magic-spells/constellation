---
name: repos.ts
status: verified
path: src/core/repos.ts
language: typescript
summary: Connected-repo declarations + repo selector resolution
connections:
  - FILE-MCP-SERVER
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
verified_at: '2026-08-24T21:10:24.908Z'
notes:
  - kind: state
    text: >-
      codeRootFor(planRoot) added: reads optional code_root from plan.md frontmatter, resolves
      against dirname(planRoot), defaults to dirname(planRoot); never throws (git-less plans work).
      repoRootOf is deliberately NOT the code root — it resolves connected_repos paths and must stay
      dirname(planRoot) regardless of any code_root override; the comment now says so. See
      DECISION-MONOREPO-CODE-ROOT.
---

Reads/writes `connected_repos` on PLAN-PROJECT and resolves the `repo` selector (name or path) to a sibling plan root. Repo-level links only — cards never connect across repos.

`discoverConnectedWorkspaces` turns those entries into the viewer's workspaces for [[FILE-SERVE]]: each repo's plans, discovered inside its own git root, or `available: false` with a reason (missing path, not a directory, not git, no plan). It never throws for a bad entry, never reads a connected repo's own `connected_repos`, and is stricter than local discovery because another repo's viewer will write these plans: a real `plan.md` in a non-symlinked folder whose realpath stays in the repo, and a `code_root` whose realpath stays in it too (else `rejected`, reported rather than dropped).

`codeRootFor` also lives here, and it is the module's other half: the folder whose code a plan describes — the directory containing `constellation/`, or PLAN-PROJECT's `code_root` override. [[FILE-CODE]], [[FILE-STALE]], [[FILE-GIT]], [[FILE-SYNC]], [[FILE-RESOLVE]], `assemble`, serve style assets and working memory all resolve through it, so a monorepo package plan sees its own subtree rather than the repo root. It never throws, which is what lets a git-less plan still resolve bound code.

**`code_root` is bounded** (`resolveCodeRoot`, 1.1.0). plan.md is repo content, so a cloned repo controls it: `code_root` is kept only when its realpath stays inside the plan's git repository (outside git, inside the folder holding the plan). Otherwise `codeRootFor` falls back to the default and `escape` says why, so no reader or writer can leave the repo; working memory refuses outright with `UNSAFE_PATH`. Through 1.0.x a cloned plan could point `code_root` elsewhere and get outside files attached to agent context.

The two roots are deliberately distinct: `code_root` moves where a plan's *own* code lives and says nothing about where sibling repos sit, so `connected_repos` paths keep resolving against the plan's parent directory whatever `code_root` says.
