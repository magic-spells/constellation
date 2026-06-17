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

- **The spec** — `docs/001-file-format.md` (normative format) and `docs/002-mcp.md` (MCP design).
- **The implementation** — `src/` (parser, indexer, lint, CLI, MCP server, viewer server).
- **The authoring skill** — `skill/SKILL.md` + `skill/types/*.md`, with golden examples.
- **The golden plan** — `examples/constellation/`, which lints clean and doubles as the test fixture.

> Tool vs. project: keep tool concerns out of any example plan content and vice versa.
> The examples plan is a *sample ticketing app*, not documentation of Constellation.

## Commands

```sh
npm install
npm test                 # vitest (run once); npm run test:watch to watch
npm run build            # tsc → dist/
npm run lint:examples    # lint the golden plan — must stay clean (0 errors)
npm run dev -- <cmd>     # run the CLI from source via tsx, e.g. `npm run dev -- lint examples`
npm run dev:viewer       # vite dev server for the Svelte viewer
npm run build:viewer     # build static viewer assets → viewer/dist
npm run serve:examples   # serve the golden plan in the viewer (no auto-open)
```

CLI surface (`src/cli/index.ts`): `init`, `lint`, `mcp`, `serve`, `repos`, `version`/`v`, `upgrade`.
`lint` exits **1** on errors, **0** otherwise (warnings never fail); **2** when no plan is found.

## Architecture

The pipeline is one direction: **files → index → (lint | serve | MCP)**.

| Module | Responsibility |
|---|---|
| `src/core/parse.ts` | Split a file into YAML frontmatter + body (gray-matter). |
| `src/core/handles.ts` | Handle grammar, the 17 canonical prefixes, type↔folder map. |
| `src/core/extract.ts` | Pull references out of a card: `[[HANDLE]]` body links, handle-shaped frontmatter values, mermaid node IDs. |
| `src/core/indexer.ts` | `loadPlan(root)` — read every card, dedupe handles, resolve refs, build undirected connections, collect structural issues. The heart of the system. |
| `src/core/validate.ts` | Ajv schema validation against `schemas/` → W002/W003. |
| `src/core/lint.ts` | `loadPlan` + schema validation, sorted. |
| `src/core/writer.ts` | Byte-preserving card writes + deep-merge patch semantics (shared by MCP and viewer). |
| `src/core/resolve.ts` | Find the plan folder by walking up from cwd, **bounded by the repo root**. |
| `src/core/repos.ts` | Connected-repo declarations on `PLAN-PROJECT` (`connected_repos`) and repo selector resolution. |
| `src/cli/index.ts` | The `constellation` binary. |
| `src/mcp/` | MCP server (`server.ts`), full-text search (`search.ts`), git change-tracking (`git.ts`). |
| `src/serve/server.ts` | Local HTTP server: serves `viewer/dist`, a read API, and a PATCH/POST/DELETE write API; watches files for live reload. |
| `viewer/` | Svelte 5 + Tailwind v4 single-page viewer (themes, card pages, neighborhood diagrams). |

### Invariants — don't break these

- **Nothing derived is stored.** Connections, the graph, orphan status: all recomputed from files on every load. Never persist them into a card.
- **Structured refs are contracts; prose refs are aspirational.** A missing target in `connections`/frontmatter is an **error** (E005); a missing `[[link]]`/mermaid target is a **warning** (W004) — prose may point at a not-yet-written card.
- **Connections are undirected and deduped.** Endpoints are stored sorted (`a < b`); declaring a connection on either side is enough.
- **Writes preserve bytes.** `updateCardFile` re-serializes only the top-level frontmatter keys whose values actually changed and keeps the body byte-for-byte on a frontmatter-only update (and vice versa). A `status` flip must not reformat a neighboring table. Keep it that way.
- **Plan resolution never crosses a repo boundary.** `findPlanUp` stops at the first ancestor containing `.git` and returns null rather than adopting a sibling repo's plan.
- **Connected repos are repo-level links only.** `connected_repos` on `PLAN-PROJECT` can point to sibling repo roots; cards never connect across repos, lint never validates local sibling paths, and MCP tools only target a sibling when `repo` is explicitly passed.
- **Four frontmatter keys are reserved:** `name`, `kind`, `status`, `connections`. Type-specific `fields` may not use them; writer/MCP reject reserved keys in `fields`.
- **`plan.md` at the plan root is the one special file** — its handle is `PLAN-PROJECT`, and it's the only card not named after its handle / not in a type folder.
- **Agent guidance lives in two unshared copies — update both.** The MCP server embeds its own `INSTRUCTIONS` string (`src/mcp/server.ts`) and never reads the skill; the skill (`skill/SKILL.md`, `skill/methodology.md`) is loaded only by the agent harness. Neither imports the other. Any change to *how an agent should use the plan* — workflows, commands, terminology, the plan↔code sync loop — must land in **both**, and stay consistent with the spec in `docs/`.

### Lint codes (keep in sync with `docs/001-file-format.md`)

Errors (break the graph, exit 1): **E001** bad filename handle · **E002** unknown prefix ·
**E003** duplicate handle · **E004** bad `connections` entry · **E005** structured ref to
no card · **E006** invalid YAML.
Warnings (quality, exit 0): **W001** wrong folder · **W002** schema violation ·
**W003** unknown field · **W004** dangling prose/mermaid ref.

## The 17 card types

`API DB DATATYPE ROLE DOC FILE TEST EXTERNAL EVENT COMPONENT PAGE JOB FLOW STATE
DIAGRAM AGENT PLAN` (defined in `src/core/types.ts`; folders in `src/core/handles.ts`).

**Adding or renaming a type touches four places that must agree:**

1. `TYPE_NAMES` in `src/core/types.ts` and `TYPE_FOLDERS` in `src/core/handles.ts`
2. `schemas/<folder>.json` (the JSON Schema for its frontmatter)
3. `skill/types/<folder>.md` (authoring reference + golden example)
4. `examples/constellation/<folder>/` (a clean sample card) and the type table in `docs/001-file-format.md`

(The current working tree is mid-rename: `ARCH`→`DIAGRAM` and `EXT`→`EXTERNAL`. If you
touch type plumbing, make sure all four locations land together.)

## MCP server (`src/mcp/server.ts`)

`constellation mcp` exposes the plan over stdio. Design notes worth preserving:

- **Hydrated retrieval:** `get_card` / `search` / `traverse` can return connected cards' *full* frontmatter and body in one call (`connected: "full"`).
- **Validated writes:** every write tool lints and returns the issues for the file it touched. A card is still created/updated when issues come back — issues are lint *state*, not failure. `create_cards` / `add_connections` batch and lint **once** so intra-batch references resolve.
- **Git change-tracking:** `diff_plan` (per-card changes since the `.sync.json` marker or HEAD), `plan_log`, `set_sync_point`, `check_integrity`. Never stamp dirty flags into cards — git is the source of truth for change.
- **Connected repos:** `list_connected_repos`, `add_connected_repo`, and `remove_connected_repo` manage `PLAN-PROJECT.connected_repos`; every read/write tool, including those management tools, accepts optional `repo` to target a connected repo explicitly.

## Conventions / gotchas

- **ESM, Node ≥ 22.** `package.json` is `"type": "module"`; imports use explicit `.js` extensions even from `.ts` sources (NodeNext). Keep them.
- **`strict` TypeScript**, `tsc` → `dist/`. The published package ships `dist`, `schemas`, `skill`, `docs`, `examples`, `viewer/dist` (see `files` in `package.json`).
- **The golden plan is load-bearing.** `examples/constellation/` is both the showcase and the test fixture — after changing core/schema behavior, run `npm run lint:examples` and `npm test`; the example plan must lint with zero errors.
- **Ajv ships CJS** — `validate.ts` uses `createRequire` to load `ajv/dist/2020.js`; don't "modernize" that import.
- **The viewer's write path and the MCP write path share `src/core/writer.ts`.** Fix patch/serialization bugs there once, not in two places.
