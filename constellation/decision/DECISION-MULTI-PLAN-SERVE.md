---
name: One server, every plan in the repo and its connected repos, a switcher to change
status: verified
connections:
  - FILE-SERVE
  - FILE-CLI
  - FILE-RESOLVE
  - FILE-MCP-SERVER
  - DECISION-MONOREPO-CODE-ROOT
  - PAGE-VIEWER-HOME
  - DOC-CONNECTED-REPOS
  - FILE-REPOS
notes:
  - kind: verified
    text: >-
      Built by two parallel agents (server: Codex; viewer: Opus) against the frozen contract — zero
      contract deviations reported by either. Combined gates: 701/701 tests across 58 files (four
      legacy serve files zero-diff), build + lint:examples clean, viewer bundle builds. Live smoke
      on this repo's own 2-plan server (root 78 cards + examples 26): /api/plans roster correct with
      names from PLAN-PROJECT; unprefixed /api/plan ≡ default plan; per-plan isolation; unknown id →
      JSON 404 not the SPA shell; multi banner with • default and deep-linked URL. Browser
      click-through: boots into #/p/root/ with the topbar PlanSwitcher, dropdown lists both plans
      with counts + check, switching reloads into #/p/examples/ with the whole app re-anchored, and
      a cold deep link #/p/examples/api/API-TICKETS opens that card in that plan.
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

# One server, every plan in the repo and its connected repos, a switcher to change

## Context

`constellation serve` held one plan root per process; at a monorepo root it exited 2 with "No constellation/ folder found." With plans living at `packages/<name>/constellation` ([[DECISION-MONOREPO-CODE-ROOT]]), serving a monorepo means either picking one plan or hosting them all. Chosen: host them all, switch in the viewer.

## Decision

- **Discovery** (`discoverPlans` in [[FILE-RESOLVE]], beside `findPlanUp`): BFS down from the git root (or cwd without one), maxDepth 3, accepting only dirs containing `constellation/plan.md`. Never descends into node_modules, dot-dirs, dist/build/out/coverage/target/vendor/tmp, another `constellation` dir, or **any dir containing `.git`** — the downward mirror of the upward `.git` stop. Runs once at startup; a new plan needs a restart.
- **Connected workspaces:** the launching repo's root (else default) plan's `connected_repos` are discovered the same way inside each repo's own git root and served beside the home plans — one level only, fixed at startup, with stricter checks (real `plan.md`, no symlinked plan folder, `code_root` inside the repo). Unreachable repos are roster rows, never a crash ([[FEATURE-WORKSPACE-SWITCHER]]).
- **Plan identity:** the repo-root plan is always `root`; otherwise the slugified code-root basename when unique, else the dashed relative path (`packages-puzzle`), which is ALWAYS accepted as an alias so short-id demotion never rots a link. Collisions get `-2`/`-3`. Connected plans are `<name>` / `<name>-<planid>` and never shadow a home id.
- **API addressing:** path prefix — `/api/p/<id>/{plan,sync,docs,atlas-metrics,atlas-config,style-asset,cards,card/<HANDLE>,sync-point,events}`. Unprefixed routes resolve to the **default plan**, so single-plan repos and old bookmarks are unchanged. `GET /api/plans` is the roster: id, name, aliases, card count, plus `available`, `reason` and `repo { name, path, root, kind: self|connected, description? }`. An unmatched `/api/*` is a JSON 404. **Security invariant: a plan id is a Map lookup built at startup — never joined onto a filesystem path**; the map doubles as the write allowlist.
- **Server state:** per-plan `PlanState` (repoUrl memo, metrics cache, cardCount, SSE clients, watcher, debounce), one recursive `fs.watch` per plan root. `close()` tears all of it down. Git, sync and drift run from each plan's own root; style assets fall back to the plan's own repo root, contained by realpath.
- **Viewer:** the plan rides the hash via Puzzle's `routerBase = '/p/<id>'`, so routes and hrefs need no changes. The roster is fetched before the app is constructed; failure degrades to single-plan. With more than one openable plan, the rail's `WorkspaceSwitcher` (which replaced the topbar `PlanSwitcher`) switches by `location.replace('#/p/<id>/')` + reload — routerBase is fixed at construction. Boot canonicalisation keeps the route (`scopeHash`). localStorage keys stay global.
- **MCP `start_viewer`:** gains `repo`, boots multi-plan like the CLI, returns `plan_url` beside `url`. A running viewer that serves the wanted plan returns its deep link; otherwise `requested_plan_not_served` with a stop_viewer hint — **never auto-restart**.
- **CLI:** bare `serve` at a monorepo root boots multi-plan; `--plan <id>` sets the default (not a filter); `constellation serve <path>` stays single-plan; the banner lists the roster, marks connected plans and lists skipped repos.

## Alternatives

- **CLI picker** — rejected: a second, worse switcher (up-front choice, unchangeable without restart, doesn't survive into the browser) beside a dropdown that does the job better; also breaks non-interactive/CI paths.
- **`?plan=` query param** — rejected: the path prefix composes with `routerBase` (both prefixes, hash and wire in lockstep), gives SSE a natural channel per plan, and `style-asset` already owns the query string.
- **One repo-root watcher with path→plan routing** — rejected: fires on every install/build/.git churn, and cross-platform fs.watch filename reporting is too unreliable to route on.
- **One tagged SSE stream** — rejected: every client wakes for every plan's changes; per-plan channels reuse the same sharding as everything else and keep the wire format byte-identical.
- **In-place plan switching** — rejected: requires rebuilding the router (base is fixed at construction), re-pointing the data layer, resetting SSE and index state; a local reload costs tens of milliseconds and is honest.
- **Live plan re-discovery** — deferred: dynamic watcher add/remove and state migration for a rare, deliberate event; restart instead.
- **A per-plan lint cache** — deferred: write handlers re-lint expecting to observe their own write; watcher-based invalidation races that read. Separate follow-up.

## Consequences

- This repo itself becomes a 2-plan repo (`root` + `examples`) under bare `serve` — accepted, and it is the live dev target for the viewer work.
- Single-plan repos: no dropdown, today's URLs, `ServeOptions` keeps a `{planRoot}` arm so existing callers and tests compile unchanged.
- The `/api/plans` roster and the multi-plan banner share one cheap `.md`-count source; the single-plan banner keeps its loadPlan-derived count byte-identical.
