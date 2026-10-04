---
name: Workspace switcher across connected repos
status: verified
release: RELEASE-V1-1-0
change: feature
branch: feat/workspace-switcher
pr: '#43'
code_refs:
  - viewer/app/components/WorkspaceSwitcher.pzl
  - viewer/app/components/ConnectedRepos.pzl
  - viewer/app/lib/workspaces.js
  - viewer/app/lib/plans.js
  - src/core/repos.ts
  - src/serve/server.ts
connections:
  - DECISION-MULTI-PLAN-SERVE
  - DECISION-SERVE-REQUEST-GUARD
  - DOC-CONNECTED-REPOS
  - FILE-SERVE
  - FILE-REPOS
  - FILE-RESOLVE
  - FILE-CLI
  - FILE-WRITER
  - PAGE-VIEWER-HOME
  - FEATURE-VIEWER-SHELL-1-1
verified_at: '2026-10-04T22:03:30.324Z'
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
notes:
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

One `constellation serve` shows this repo's plans and its connected repos' plans, and the project name at the top of the rail switches between them.

## Scope

- **Server.** At startup `serve` reads `connected_repos` from the launching repo's root (else default) plan and discovers each connected repo's plans inside its own git root ([[FILE-REPOS]] `discoverConnectedWorkspaces`). One level only — a connected repo's own `connected_repos` are never followed — and the set is fixed until restart.
- **Stricter than local discovery,** because these plans are served and written from another repo's viewer: a real `plan.md`, a plan folder that is not a symlink and whose realpath stays inside the connected repo, and a `code_root` whose realpath stays inside it too. A plan that fails the last check is listed unavailable, its id derived from its plan folder.
- **Roster.** `/api/plans` entries gain `available`, `reason` and `repo { name, path, root, kind: self|connected, description? }`. A missing path, a non-git directory, no plan, or a read/watch failure (EACCES, EMFILE) is an unavailable row — never a crash.
- **Ids.** This repo's are unchanged. Connected plans get `<name>` / `<name>-<planid>`, never shadow a home id, and collide to `-2`/`-3`; unavailable repos still reserve theirs so ids stay stable.
- **Viewer.** `WorkspaceSwitcher.pzl` replaces the rail's brand row and `PlanSwitcher` (deleted): monogram, project name, chevron; a listbox grouped "This repo" / "Connected repos" with counts, a check on the active row, disabled rows showing the reason; full keyboard. The collapsed rail shows only the monogram; the phone drawer has the same switcher at its head.
- **No product wordmark.** The tab title is `<project> · <page>`; routes carry no `meta.title`.
- **Deep links.** Boot canonicalisation keeps the route (`scopeHash`): `#/api/X` becomes `#/p/<id>/api/X`.
- **Home's connected repos** link into their workspaces; unavailable or unserved ones stay inert and show why ([[PAGE-VIEWER-HOME]]).

The request guard landed with this work, because serving another repo's plans made the old open write surface worse — [[DECISION-SERVE-REQUEST-GUARD]].

## Acceptance

- `tests/serve-workspaces.test.ts`: roster, unavailable repos, id stability, per-repo git for sync and sync point, a write into a connected plan, 404 for unknown/unavailable ids, one level only.
- `tests/serve-hardening.test.ts`: Host/Origin guard, `--dev-origin`, symlink containment.
- `tests/viewer/workspaces.test.js`: model, monograms, roster matching, switcher keyboard.
