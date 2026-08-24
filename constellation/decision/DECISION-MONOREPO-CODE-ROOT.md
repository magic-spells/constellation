---
name: 'Plans can live below the git root: the code root'
status: built
connections:
  - FILE-CODE
  - FILE-STALE
  - FILE-GIT
  - FILE-SYNC
  - FILE-MCP-SERVER
  - FILE-REPOS
  - FILE-RESOLVE
  - FILE-SERVE
  - DOC-CONNECTED-REPOS
  - DOC-CHANGE-TRACKING
  - DOC-FILE-FORMAT
notes:
  - kind: verified
    text: >-
      Verified against the trigger monorepo (puzzle, 356 cards) with the patched build:
      missing_files = 0 across all ~210 stale entries (was 67/68 bound paths resolving to nowhere);
      package_version reads 0.7.0 (was the 0.0.0 root shell); commit counting scoped (0 since
      marker); stale entries carry real baselines + real code-root-relative changed files — the
      remaining stale count is honest rename-drift from the monorepo import awaiting the deferred
      re-baseline sweep, not an artifact. Single-package control (tarot): stale 25/26 on BOTH the
      installed 0.6.0 and the patched build — exact no-op. Suite 656/656, build + lint:examples
      clean, existing tests unedited except the intentional orient-shape and skip-reason-string
      assertions.
---

# Plans can live below the git root: the code root

## Context

A monorepo puts plan folders inside packages (`packages/<name>/constellation`), so "the folder whose code this plan describes" and the git toplevel stop being the same directory. Constellation resolved bound code, versions, and commit scopes against the git toplevel (~20 call sites via `repoRootFor`), which silently corrupts every path-coupled signal in a monorepo: bound files read as missing, a missing bound file counts as drift so cards go permanently stale, the version check reads the monorepo shell's package.json, commit counts include sibling packages, and set_verified's dirty-bound-file warning compares mismatched paths and never fires.

## Decision

Two distinct roots, each with a name:

- **Code root** — the code a plan describes. Default `dirname(planRoot)`; optional `code_root` field on PLAN-PROJECT frontmatter (resolved against `dirname(planRoot)`) for layouts where the plan is not a sibling of its code. Card `path:` and `code_refs` values are code-root-relative. Everything answering "what code does this plan describe" — [[FILE-CODE]] resolution and metrics (containment and symlink guards included), [[FILE-STALE]] inputs, [[FILE-SYNC]]'s version read — uses the code root, via one exported seam `codeRootFor(planRoot)`. Serve's style-asset resolution moves to the code root with the multi-plan serve work (DECISION-MULTI-PLAN-SERVE); until then it stays `dirname(planRoot)`.
- **Git root** — where `.git` lives; used only for genuine git plumbing (rev-parse, running git, SHAs). `verified_sha` stays a repo-wide HEAD sha. `repoRootOf` (connected_repos path resolution) also deliberately stays `dirname(planRoot)` — it is not the code-root concept.

Git speaks repo-relative paths while cards store code-root-relative ones, so every git boundary translates: prefix bound paths with the code root's repo-relative prefix going into git, strip it coming back ([[FILE-STALE]], [[FILE-GIT]] pathspecs, set_verified's dirty check). Commit-scoped git logs pass `--full-history` so TREESAME merge simplification cannot silently prune real code commits.

In a single-package repo the two roots are the same directory and every path through the code is a no-op — this is the default behavior, not an opt-in mode. One deliberate exception: `codeRootFor` does not throw outside a git repo (the old git-root lookup did), so code resolution and metrics now work in a plan that has no git repo at all.

Boundary rules stay symmetric: walking up for a plan still stops at `.git` (never adopt a sibling repo's plan), and scanning down for plans inside one repo stops at any nested `.git`. Cards never connect across plans. A monorepo root holds at most a thin signpost plan (plan.md only) whose `connected_repos` names the package plans so `repo=<name>` routes to them.

## Alternatives

- **Rewrite cards with `../../packages/<name>/…` paths** — impossible by design: [[FILE-CODE]]'s containment guard rejects escaping paths, and that guard is correct. The code had to change.
- **Opt-in "monorepo mode"** — rejected: the implicit default is a provable no-op where plan and git root coincide; a mode flag is one more thing to forget.
- **A root plan as a hand-maintained index of the packages** — rejected: it drifts and duplicates the sub-plans. The signpost carries only `connected_repos` routing.

## Consequences

- Monorepo plans report true staleness, versions, and drift; the false-missing / permanently-stale class disappears.
- Every `repoRootFor` call site is sorted into codeRoot vs gitRoot deliberately; new code must pick one on purpose.
- Multi-plan serve landed on `codeRootFor` ([[DECISION-MULTI-PLAN-SERVE]]): `discoverPlans` keys each plan by its code root, and the style-asset move deferred above resolved as code-root first with a git-root fallback, containment enforced on whichever root served.
- Done as required: all three guidance copies teach the two-root model ([[AGENT-GUIDANCE]]), and the schemas now say "relative to the code root".
