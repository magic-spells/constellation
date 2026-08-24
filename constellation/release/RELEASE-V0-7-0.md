---
name: v0.7.0 — plans that know where they live
status: building
version: 0.7.0
connections:
  - DECISION-MONOREPO-CODE-ROOT
  - DECISION-MULTI-PLAN-SERVE
  - DOC-MCP-SERVER
  - DOC-CHANGE-TRACKING
---


Theme: a plan stops assuming it **is** the repo.

0.6.0 made a plan readable. This one makes it locatable. Three of the four
workstreams answer the same question — what happens when the plan is not the
whole repo. [[DECISION-MONOREPO-CODE-ROOT]] splits the code a plan describes
from the git root it lives under, so a plan at `packages/<name>/constellation`
reports true staleness, versions and drift instead of silently measuring the
monorepo shell. [[DECISION-MULTI-PLAN-SERVE]] lets one server host every plan
in a repo, with a switcher in the viewer. And the sync path stopped spawning
git per card — the reason a 354-card plan took 6.1s to answer "are we in
sync"; the rule that came out of it is on [[DOC-CHANGE-TRACKING]].

The fourth is smaller and different in kind: three places where the tools
failed quietly or priced the honest path too high — a re-verification sweep
that cost one call per card, a search that dead-ended on zero hits instead of
relaxing, and an unknown-field warning that made you go ask what the fields
were ([[DOC-MCP-SERVER]]).

## Upgrade notes

Additive. Nothing to migrate.

- **Monorepo support is the default, not a mode.** Where a plan sits beside the
  code it describes — every single-package repo — the code root and the git
  root are the same directory and every path through the change is a no-op.
  `code_root` on `PLAN-PROJECT` is optional, for layouts where the plan is not
  a sibling of its code.
- **Viewer URLs gain a plan segment** (`#/p/<id>/`) when a repo serves more
  than one plan. One plan, one URL, unchanged.
- **`set_verified` takes `handles: [...]`** for a sweep. The single-`handle`
  call is untouched, response shape included.
- **A zero-hit `search` now answers** — relaxed OR results carrying
  `relaxed: true` and `unmatched_terms`. Anything keying off "no matches" as a
  bare empty list should read `relaxed`.
- **W003's message text changed**; it now names the type's valid fields. The
  code and what it means did not.
