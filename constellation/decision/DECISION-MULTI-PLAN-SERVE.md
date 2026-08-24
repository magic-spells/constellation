---
name: One server, every plan in the repo, a dropdown to switch
status: built
connections:
  - FILE-SERVE
  - FILE-CLI
  - FILE-RESOLVE
  - FILE-MCP-SERVER
  - DECISION-MONOREPO-CODE-ROOT
  - PAGE-VIEWER-HOME
  - DOC-CONNECTED-REPOS
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
---

# One server, every plan in the repo, a dropdown to switch

## Context

`constellation serve` held one plan root per process; at a monorepo root it exited 2 with "No constellation/ folder found." With plans living at `packages/<name>/constellation` ([[DECISION-MONOREPO-CODE-ROOT]]), serving a monorepo means either picking one plan or hosting them all. Chosen: host them all, switch in the viewer.

## Decision

- **Discovery** (`discoverPlans` in [[FILE-RESOLVE]], beside `findPlanUp`): BFS down from the git root (or cwd without one), maxDepth 3, accepting only dirs containing `constellation/plan.md`. Never descends into node_modules, dot-dirs, dist/build/out/coverage/target/vendor/tmp, another `constellation` dir, or **any dir containing `.git`** — the downward mirror of the upward `.git` stop. Runs once at startup; a brand-new plan needs a serve restart (documented limitation).
- **Plan identity:** the repo-root plan is always `root`; otherwise the slugified code-root basename when unique across the set, else the full dashed relative path (`packages-puzzle`). The dashed path form is ALWAYS accepted as an alias, so short-id demotion (a second `puzzle` appearing) never rots a link. Collisions after that get `-2`/`-3` in code_path order.
- **API addressing:** path prefix — `/api/p/<id>/{plan,sync,docs,atlas-metrics,atlas-config,style-asset,cards,card/<HANDLE>,sync-point}` plus per-plan SSE `/api/p/<id>/events`. Every unprefixed route survives and resolves to the **default plan**, so single-plan repos are byte-identical and old bookmarks work. `GET /api/plans` lists the roster. An unmatched `/api/*` is a JSON 404, never the SPA fallback. **Security invariant: a plan id is a Map lookup built at startup — never joined onto a filesystem path**; the map doubles as the write-route allowlist.
- **Server state:** per-plan `PlanState` (repoUrl memo, metrics cache, cardCount, SSE client set, watcher, debounce), one recursive `fs.watch` per plan root — never one repo-root watcher (build/node_modules churn thrashes the debounce, and fs.watch filename attribution is unreliable). `close()` tears down every watcher, debounce, and SSE response per plan. SSE wire format unchanged (`data: change`). Style assets resolve code-root-first with a git-root fallback, containment enforced on whichever root served.
- **Viewer:** the plan rides the URL as a hash segment via Puzzle's `routerBase = '/p/<id>'` — all routes and hrefs become plan-scoped with no changes to routes.js or `hrefForHandle` (the app-facing router surface is base-free). The roster is fetched before the app is constructed; a fetch failure degrades to base-less single-plan behavior. The topbar's project name becomes the PlanSwitcher dropdown only when more than one plan exists; the signpost/shell plan is listed like any other. Switching = `location.replace('#/p/<id>/')` + reload — routerBase is fixed at construction, and a reload against a local server is honest project-switching. localStorage keys stay global (appearance prefs, not plan data).
- **MCP `start_viewer`:** gains `repo`, boots multi-plan like the CLI, returns `plan_url` (deep link) beside the back-compat `url`. If a viewer is already running and the wanted plan is served, return its deep link; if not served, report `requested_plan_not_served` with a stop_viewer hint — **never auto-restart** (it would yank an open tab).
- **CLI:** bare `serve` at a monorepo root boots multi-plan directly; `--plan <id>` sets the default (not a filter); explicit `constellation serve <path>` stays the single-plan escape hatch; multi-plan banner lists the roster with the default marked.

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
