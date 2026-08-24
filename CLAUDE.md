# CLAUDE.md

Guidance for AI agents working **on Constellation itself** (this repo is the tool +
spec). If you instead want to author a Constellation *plan* in some other repo, that's
the `constellation` skill's job — not this file.

## What this repo is

Constellation is a files-first way to keep a project's architecture plan in the repo as
markdown **cards**. One file per card; the filename is the card's **handle**
(`api/API-TICKETS.md` → handle `API-TICKETS`). Cards are frontmatter (structure) +
markdown (narrative), linked by undirected **connections**. The graph is always
*derived* from the files — nothing derived is ever written back to disk.

This repo ships four things that must stay consistent with each other:

- **The spec** — Constellation's own plan in `constellation/` (the format in `DOC-FILE-FORMAT` / `DOC-CARD-TYPES` / `DOC-LINT-CODES`, the MCP design in `DOC-MCP-SERVER`, the memory/durability decisions in `DOC-MCP-UPGRADES`); formerly `docs/`.
- **The implementation** — `src/` (parser, indexer, lint, CLI, MCP server, viewer server).
- **The authoring skill** — `skill/SKILL.md` + `skill/types/*.md`, with golden examples.
- **The golden plan** — `examples/constellation/`, which lints clean and doubles as the test fixture.

> Two plan folders, kept separate: `constellation/` is Constellation's *own* plan (this tool,
> as cards — the spec lives here). `examples/constellation/` is a *sample ticketing app*
> fixture that lints clean and the tests use — not documentation of Constellation. Don't let
> tool concerns and example content leak into each other.

## Commands

```sh
npm install
npm test                 # vitest (run once); npm run test:watch to watch
npm run build            # tsc → dist/
npm run lint:examples    # lint the golden plan — must stay clean (0 errors)
npm run dev -- <cmd>     # run the CLI from source via tsx, e.g. `npm run dev -- lint examples`
npm run dev:viewer       # puzzle dev server for the viewer (cwd viewer/)
npm run build:viewer     # copy:vendor (mermaid + three) then puzzle build → viewer/dist
npm run serve:examples   # serve the golden plan in the viewer (no auto-open)
```

CLI surface (`src/cli/index.ts`): `init`, `lint`, `rename`, `mcp`, `serve`, `repos`, `add skills`, `version`/`v`, `upgrade`.
`add skills` copies the packaged `skill/` into `~/.claude` / `~/.codex` / `~/.cursor` / `~/.agents` skills dirs with a
`.constellation-skill-version` stamp (`src/cli/skills.ts`); `upgrade` offers to refresh those installs afterward.
`lint` exits **1** on errors, **0** otherwise (warnings never fail); **2** when no plan is found.
`rename OLD NEW` moves a card file and rewrites every reference plan-wide — same engine as the
MCP `rename_card` (`src/core/rename.ts`).

## Architecture

The pipeline is one direction: **files → index → (lint | serve | MCP)**.

| Module | Responsibility |
|---|---|
| `src/core/parse.ts` | Split a file into YAML frontmatter + body (gray-matter). |
| `src/core/handles.ts` | Handle grammar, the 21 canonical prefixes, type↔folder map. |
| `src/core/extract.ts` | Pull references out of a card: `[[HANDLE]]` body links, handle-shaped frontmatter values, mermaid node IDs. |
| `src/core/indexer.ts` | `loadPlan(root)` — read every card, dedupe handles, resolve refs, build undirected connections, collect structural issues. The heart of the system. |
| `src/core/validate.ts` | Ajv schema validation against `schemas/` → W002/W003. |
| `src/core/lint.ts` | `loadPlan` + schema validation, sorted. |
| `src/core/writer.ts` | Byte-preserving card writes (atomic, per-file locked) + deep-merge patch semantics + note-append / section-replace / handle-rewrite helpers (shared by MCP and viewer). |
| `src/core/rename.ts` | Plan-wide handle rename: move the card file, rewrite every reference as whole tokens (shared by MCP `rename_card` and CLI `rename`). |
| `src/core/code.ts` | Code binding: resolve a card's bound files (connected FILE `path:` + own `code_refs`) and attach contents under size caps (shared by `get_card` code mode, `stale_report`, `assemble`). |
| `src/core/stale.ts` | `computeStaleCards` — the code-side drift verdict (claim card's bound files vs its baseline: `verified_sha`, else the passed base, else the sync marker; one git diff per distinct baseline). Shared by MCP `stale_report` / `check_sync` and the viewer's `/api/sync`. |
| `src/core/git.ts` | Git change-tracking plumbing: `diffPlan`, `planLog`, sync-marker read/write, `changedFilesSince`, `recentPlanActivity` / `recentCodeActivity`, `latestTag` (revisions guarded by `safeRev` + `--end-of-options`). |
| `src/core/sync.ts` | `computeSyncStatus` — live freshness verdict (`in-sync`/`drifted`/`dirty`/`never-synced`/`no-git`) plus the dashboard payload (code activity, latest tag, package version, stale). |
| `src/core/resolve.ts` | Find the plan folder by walking up from cwd, **bounded by the repo root**. |
| `src/core/repos.ts` | Connected-repo declarations on `PLAN-PROJECT` (`connected_repos`) and repo selector resolution. |
| `src/cli/index.ts` | The `constellation` binary. |
| `src/mcp/` | MCP server (`server.ts`) and full-text search (`search.ts`). Git change-tracking lives in `src/core/git.ts`. |
| `src/core/atlas-config.ts` | `constellation/atlas.json` — authored atlas layout (district order, pins, shape/height overrides, default lens/engine, hide list). Read/normalize/write; malformed degrades to defaults. |
| `src/serve/server.ts` | Local HTTP server: serves `viewer/dist`, a read API, and a PATCH/POST/DELETE write API; watches files for live reload. |
| `viewer/app/lib/atlas-scene.js` | **Pure** scene-graph builder for the atlas: districts from FEATURE connections, buildings, floors, orthogonal roads from FLOW steps. Deterministic by contract — same plan in, byte-identical scene out. Both renderers consume it. |
| `viewer/app/lib/atlas-iso.js` · `atlas-three.js` | The two painters: canvas-2D isometric (default) and lit three.js (lazy, vendored). Neither computes a position. |
| `viewer/app/lib/canvas-camera.js` | Camera, easing and the on-demand rAF driver, shared by the graph and the atlas so the two canvases cannot drift. |
| `viewer/` | Puzzle + puzzle-pieces + Tailwind v4 single-page viewer (themes, card pages, neighborhood diagrams). Pieces copied in by `puzzle add piece` live in `viewer/app/components/ui/` and are **our** code — edit them freely; `viewer/pieces.lock` hashes drift on purpose when we do. Theming is two axes: `data-scheme` (observatory, default, warm, void, dim) and `data-theme` (light/dark/system), both set pre-paint by an inline script in the shell. |

### Invariants — don't break these

- **Nothing derived is stored.** Connections, the graph, orphan status: all recomputed from files on every load. Never persist them into a card. The one recorded per-card baseline is `verified_sha`/`verified_at` (from `set_verified`) — verification *provenance*, not a derived value or a change flag; the drift *verdict* over it is still recomputed live by `stale_report`/`check_sync` and never stored.
- **Structured refs are contracts; prose refs are aspirational.** A missing target in `connections`/frontmatter is an **error** (E005); a missing `[[link]]`/mermaid target is a **warning** (W004) — prose may point at a not-yet-written card.
- **Connections are undirected and deduped.** Endpoints are stored sorted (`a < b`); declaring a connection on either side is enough.
- **Writes preserve bytes.** `updateCardFile` re-serializes only the top-level frontmatter keys whose values actually changed and keeps the body byte-for-byte on a frontmatter-only update (and vice versa). A `status` flip must not reformat a neighboring table. Keep it that way.
- **Plan resolution never crosses a repo boundary.** `findPlanUp` stops at the first ancestor containing `.git` and returns null rather than adopting a sibling repo's plan.
- **Connected repos are repo-level links only.** `connected_repos` on `PLAN-PROJECT` can point to sibling repo roots; cards never connect across repos, lint never validates local sibling paths, and MCP tools only target a sibling when `repo` is explicitly passed.
- **Four frontmatter keys are reserved:** `name`, `kind`, `status`, `connections`. Type-specific `fields` may not use them; writer/MCP reject reserved keys in `fields`. **`schemas/card.json` is also the home for cross-type metadata** — valid on every type, not reserved. Two kinds live there and they behave differently: **tool-managed provenance** (`code_refs`, `verified_sha`, `verified_at`, `notes`) is written by the tools and never hand-authored, while **authored placement** (`section`, `order`) is set by whoever writes the card to put it in the compiled document (`PAGE-VIEWER-DOCS`). Say which kind a new key is in its schema description. `validate.ts` derives the W003 base allow-list from card.json's properties (not a hardcoded list), so a field added there is blessed on all 21 types and AJV validates its shape (W002). Add cross-type metadata to card.json, not to each type schema.
- **`plan.md` at the plan root is the one special file** — its handle is `PLAN-PROJECT`, and it's the only card not named after its handle / not in a type folder.
- **Two non-card files may sit in a plan folder, and only two:** `.sync.json` (provenance — a sha somebody stamped) and `atlas.json` (authored atlas placement). Both hold input, never anything derivable from the cards, so "nothing derived is stored" still holds. Adding a third needs a DECISION card arguing the same way `DECISION-ATLAS-CONFIG-FILE` does.
- **Agent guidance lives in three unshared copies — update all three.** The MCP server embeds its own `INSTRUCTIONS` string (`src/mcp/server.ts`) and never reads the skill; the skill is itself two files loaded only by the agent harness — `skill/SKILL.md` and `skill/methodology.md`. None of the three imports another. Any change to *how an agent should use the plan* — workflows, commands, terminology, the plan↔code sync loop, the tool surface — must land in **all three**, and stay consistent with the spec cards in `constellation/`. `tests/guidance-consistency.test.ts` enforces this, and caps `INSTRUCTIONS` at 55 lines and `SKILL.md` at 340.
  **`skill/atlas.md` is NOT a fourth copy.** It is a topical reference like `skill/types/*.md` — authoring guidance for one feature, pointed at from SKILL.md, and it joins only the names-only-real-tools check. Keep it that way: new topical files are cheap, a fourth canonical copy is not.

### Lint codes (keep in sync with `constellation/doc/DOC-LINT-CODES.md`)

Errors (break the graph, exit 1): **E001** bad filename handle · **E002** unknown prefix ·
**E003** duplicate handle · **E004** bad `connections` entry · **E005** structured ref to
no card · **E006** invalid YAML.
Warnings (quality, exit 0): **W001** wrong folder · **W002** schema violation ·
**W003** unknown field · **W004** dangling prose/mermaid ref.

## The 21 card types

`API DB DATATYPE ROLE DOC DECISION FILE TEST EXTERNAL EVENT COMPONENT PAGE JOB FLOW STATE
DIAGRAM AGENT PLAN FEATURE RELEASE STYLE` (defined in `src/core/types.ts`; folders in `src/core/handles.ts`).

**Adding or renaming a type touches four places that must agree:**

1. `TYPE_NAMES` in `src/core/types.ts` and `TYPE_FOLDERS` in `src/core/handles.ts`
2. `schemas/<folder>.json` (the JSON Schema for its frontmatter)
3. `skill/types/<folder>.md` (authoring reference + golden example)
4. `examples/constellation/<folder>/` (a clean sample card) and the type table in `constellation/doc/DOC-CARD-TYPES.md`

## MCP server (`src/mcp/server.ts`)

`constellation mcp` exposes the plan over stdio. Design notes worth preserving:

- **Self-serving entry points:** `orient` is the one-call session opener (project, histogram, stale count, recent notes, server-vs-workspace version); `describe_type` returns a type's schema and authoring guidance, so an agent needs no skill install.
- **Search never dead-ends:** matching is AND, but a query no card matches every word of is retried as OR and returned with `relaxed: true` + `unmatched_terms`, ranked by how many words each card matched (`searchPlan` in `src/mcp/search.ts`; `searchCards` stays strict).
- **Hydrated retrieval:** `get_card` / `search` / `traverse` can return connected cards' *full* frontmatter and body in one call (`connected: "full"`). `list_cards` / `traverse` filter by status — one value or a list, `"none"` = unset — so `["planned","building","none"]` is the backlog view; traverse's status filter is a *post-filter* (the walk passes through built hubs), unlike `types` which prunes the walk.
- **Validated writes:** every write tool lints and returns the issues for the file it touched. A card is still created/updated when issues come back — issues are lint *state*, not failure. `create_cards` / `add_connections` batch and lint **once** so intra-batch references resolve; `set_verified` takes `handles: [...]` for the same reason — a re-verification sweep resolves the sha once, checks dirty bound files once, and lints once, reporting unknown handles per item (`failed`) instead of failing the batch.
- **Cheap writes (keep the memory honest):** `append_note` (append-only typed note — decision/gotcha/state/deviation/verified) and `edit_section` (replace one `##` section) are byte-preserving — the low-friction path that prevents drift. Notes are retrievable: `search` indexes note text, `list_notes` queries them across cards by kind.
- **Graph-safe rename:** `rename_card` moves the card file and rewrites every reference plan-wide as whole tokens (connections, frontmatter values, `[[links]]`, mermaid). Never delete-and-recreate to rename.
- **Concurrency:** card writes are atomic (temp + rename) and serialized behind an in-process per-file lock; the cheap writes re-read the file inside the lock so concurrent small updates compose. Cross-process races remain the `if_mtime` guard's job.
- **Code binding, drift & assembly:** a card binds to code via a connected FILE card's `path:` or its own `code_refs`. `get_card(code: "paths"|"direct")` attaches it; `set_verified` stamps the `verified_sha` baseline (one card, or many via `handles`); `stale_report` / `check_sync` flag reverse drift (bound code changed since verify); `assemble` builds file-disjoint work packages from a delta. All same-repo — cards never bind across repos.
- **Git change-tracking:** `diff_plan` (per-card changes since the `.sync.json` marker or HEAD), `plan_log`, `set_sync_point`, `check_integrity`. Never stamp dirty flags into cards — git is the source of truth for change.
- **Connected repos:** `list_connected_repos`, `add_connected_repo`, and `remove_connected_repo` manage `PLAN-PROJECT.connected_repos`; every read/write tool, including those management tools, accepts optional `repo` to target a connected repo explicitly.

## Conventions / gotchas

- **ESM, Node ≥ 22.** `package.json` is `"type": "module"`; imports use explicit `.js` extensions even from `.ts` sources (NodeNext). Keep them.
- **`strict` TypeScript**, `tsc` → `dist/`. The published package ships `dist`, `schemas`, `skill`, `constellation`, `examples`, `viewer/dist` (see `files` in `package.json`).
- **The golden plan is load-bearing.** `examples/constellation/` is both the showcase and the test fixture — after changing core/schema behavior, run `npm run lint:examples` and `npm test`; the example plan must lint with zero errors.
- **Ajv ships CJS** — `validate.ts` uses `createRequire` to load `ajv/dist/2020.js`; don't "modernize" that import.
- **The viewer's write path and the MCP write path share `src/core/writer.ts`.** Fix patch/serialization bugs there once, not in two places.
- **The puzzle build emits ONE `app.js` and does not split dynamic imports.** A bundled `import('big-lib')` inlines the whole library for every reader. Big client libraries are vendored into `viewer/app/public/vendor/` by `scripts/copy-*.mjs` and imported at runtime through a **variable** URL, so esbuild leaves the `import()` alone — see `markdown.js` (mermaid) and `atlas-three.js` (three). Measured: bundling three took `app.js` from 431 KB to 1.1 MB.
- **`.pzl` traps, all three silent.** (1) `<style scoped>` does nothing on a *component* — views may scope, components use plain `<style>`, which is collected into one sheet. (2) `{@html x}` does not compile; render pre-sanitized HTML through an `island` ref and `innerHTML`, as `FlowSteps.pzl` does. (3) **Values a view's `data()` returns are merged back into its data**, so reading one via `getData()` gives you the previously *resolved* value, not your state — keep the user's own choice under a different key (`lensChoice` vs `lens`). Related: a `setData` that lands after an `await` is outside the event tick and does not re-render.
