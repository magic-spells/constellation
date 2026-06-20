---
name: Constellation
---

# Constellation

Files-first architecture planning for AI-assisted development. A project's architecture
plan lives in the repo as markdown **cards** — one file per card, the filename is the
**handle** — linked by undirected **connections**. The graph is always *derived* from the
files; nothing derived is ever stored. Cards are frontmatter (structure) + markdown
(narrative); git is the change-tracking system.

> **Meta:** this plan documents Constellation *itself* (the tool). It is distinct from
> `examples/constellation/`, a sample ticketing-app fixture used by the tests and the viewer
> demo — keep tool concerns and example content separate.

## What ships

One package (`@magic-spells/constellation`) that is four things at once, kept consistent:

- **A library** (`src/core/`) — parser, indexer, lint, writer, code-binding, git/sync.
- **A CLI** (`constellation`) — `init`, `lint`, `mcp`, `serve`, `repos`, `version`, `upgrade`. See [[FILE-CLI]].
- **An MCP server** (`constellation mcp`, stdio) — graph queries, hydrated retrieval,
  validated writes, git change-tracking, code binding/drift, for AI agents. See [[DOC-MCP-SERVER]].
- **A viewer** (Svelte 5 + Tailwind v4) — a local web app rendering the plan as a browsable,
  editable site. See [[PAGE-VIEWER-HOME]].

Plus the **spec** (this plan, formerly `docs/`), the **schemas** (`schemas/*.json`), the
authoring **skill** (`skill/`), and the **golden example** (`examples/constellation/`).

## The pipeline (one direction)

`files → index → (lint | serve | mcp)`. Every consumer reloads the index from disk on each
operation (tens of ms at realistic sizes), so it is always correct while files are edited in
parallel — no watcher, no cache invalidation. See [[DIAGRAM-ARCHITECTURE]].

## Design principles

1. **The files are the source of truth.** Indexes, catalogs, rollups, subgraph diagrams,
   diffs — all derived in memory, never stored.
2. **A card with no frontmatter is valid.** Path gives identity; body gives content.
3. **Git is the change-tracking system.** `git diff -- constellation/` *is* the plan diff.
   Lifecycle (`status`) is a card property; "what changed" is history — never conflated.
4. **Cheap to connect.** Connections are a plain list of handles.

See [[DOC-FILE-FORMAT]] for the normative format and [[DOC-MCP-UPGRADES]] for the
durability/cross-session-memory decisions.

## Conventions

- **ESM, Node ≥ 22**, strict TypeScript, `tsc` → `dist/`. Imports use explicit `.js`
  extensions even from `.ts` sources (NodeNext).
- **Adding/renaming a card type touches four places that must agree:** `TYPE_NAMES`
  ([[FILE-TYPES]]) + `TYPE_FOLDERS` ([[FILE-HANDLES]]); `schemas/<folder>.json`;
  `skill/types/<folder>.md`; and a sample card in `examples/` + the type table.
- **Agent guidance lives in three unshared copies that must stay consistent** — see
  [[AGENT-GUIDANCE]].
- **Writes preserve bytes; nothing derived is stored; plan resolution never crosses a repo
  boundary.** See [[FILE-WRITER]], [[FILE-RESOLVE]].
