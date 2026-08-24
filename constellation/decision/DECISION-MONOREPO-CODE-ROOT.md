---
name: 'Plans can live below the git root: the code root'
status: building
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
---

# Plans can live below the git root: the code root

## Context

A monorepo puts plan folders inside packages (`packages/<name>/constellation`), so "the folder whose code this plan describes" and the git toplevel stop being the same directory. Constellation resolved bound code, versions, and commit scopes against the git toplevel (~20 call sites via `repoRootFor`), which silently corrupts every path-coupled signal in a monorepo: bound files read as missing, a missing bound file counts as drift so cards go permanently stale, the version check reads the monorepo shell's package.json, commit counts include sibling packages, and set_verified's dirty-bound-file warning compares mismatched paths and never fires.

## Decision

Two distinct roots, each with a name:

- **Code root** — the code a plan describes. Default `dirname(planRoot)`; optional `code_root` field on PLAN-PROJECT frontmatter (resolved against `dirname(planRoot)`) for layouts where the plan is not a sibling of its code. Card `path:` and `code_refs` values are code-root-relative. Everything answering "what code does this plan describe" — [[FILE-CODE]] resolution and metrics (containment and symlink guards included), [[FILE-STALE]] inputs, [[FILE-SYNC]]'s version read, serve's style assets — uses the code root, via one exported seam `codeRootFor(planRoot)`.
- **Git root** — where `.git` lives; used only for genuine git plumbing (rev-parse, running git, SHAs). `verified_sha` stays a repo-wide HEAD sha.

Git speaks repo-relative paths while cards store code-root-relative ones, so every git boundary translates: prefix bound paths with the code root's repo-relative prefix going into git, strip it coming back ([[FILE-STALE]], [[FILE-GIT]] pathspecs, set_verified's dirty check).

In a single-package repo the two roots are the same directory and every path through the code is a no-op — this is the default behavior, not an opt-in mode.

Boundary rules stay symmetric: walking up for a plan still stops at `.git` (never adopt a sibling repo's plan), and scanning down for plans inside one repo stops at any nested `.git`. Cards never connect across plans. A monorepo root holds at most a thin signpost plan (plan.md only) whose `connected_repos` names the package plans so `repo=<name>` routes to them.

## Alternatives

- **Rewrite cards with `../../packages/<name>/…` paths** — impossible by design: [[FILE-CODE]]'s containment guard rejects escaping paths, and that guard is correct. The code had to change.
- **Opt-in "monorepo mode"** — rejected: the implicit default is a provable no-op where plan and git root coincide; a mode flag is one more thing to forget.
- **A root plan as a hand-maintained index of the packages** — rejected: it drifts and duplicates the sub-plans. The signpost carries only `connected_repos` routing.

## Consequences

- Monorepo plans report true staleness, versions, and drift; the false-missing / permanently-stale class disappears.
- Every `repoRootFor` call site is sorted into codeRoot vs gitRoot deliberately; new code must pick one on purpose.
- Multi-plan serve (one server, several plans per repo) builds on `codeRootFor` — see DECISION-MULTI-PLAN-SERVE once that lands.
- Guidance (INSTRUCTIONS / SKILL.md / methodology.md) must teach the two-root model; the schemas' "relative to the repo root" wording becomes "relative to the code root".
