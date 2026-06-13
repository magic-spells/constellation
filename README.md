# Constellation (v2 — files-first)

Your project's architecture plan as markdown files in the repo: typed cards,
connected into a graph, validated by lint, diffed by git, readable by humans on
GitHub and by AI agents with nothing more than file access.

```
constellation/
  plan.md                      ← the living project plan (PLAN-PROJECT)
  api/API-TICKETS.md           ← one file per card; the filename IS the handle
  datatype/DATATYPE-TICKET.md
  db/DB-TICKETS.md
  flow/FLOW-CREATE-TICKET.md
  ...
```

Each card is frontmatter (structure) + markdown (narrative). Connections are a
plain list of handles — plus `[[HANDLE]]` links in prose, handle-shaped values in
frontmatter fields, and handles used as Mermaid node IDs. The indexer derives the
graph; nothing derived is ever stored.

**Why files?** Plans drift from code when they live somewhere else. Here a plan
change is a commit: it rides the same branch and PR as the code it describes,
merges per-card, and "what changed in the plan" is `git diff -- constellation/`.

## Install

```sh
npm install -g @magic-spells/constellation   # the `constellation` binary
# or run without installing:
npx @magic-spells/constellation lint
```

Requires Node ≥ 22.

## Usage

```sh
constellation init          # scaffold constellation/ with a starter plan.md
constellation lint          # validate handles, references, folders, schemas
constellation mcp           # run the MCP server (stdio) for AI agents
constellation serve         # open the local viewer (editable; --readonly to disable)
```

Lint errors (broken graph: bad handles, dangling structured references,
duplicates) exit non-zero for CI; warnings (wrong folder, schema violations,
unknown fields, dangling prose links) don't block.

## Repo layout

| Path | What |
|---|---|
| `docs/001-file-format.md` | The normative format spec |
| `docs/002-mcp.md` | MCP design: tool surface, hydration, write semantics, git layer |
| `schemas/` | JSON Schemas: `card.json` (reserved keys) + one per type |
| `skill/` | AI authoring skill: `SKILL.md` + per-type references with golden examples |
| `src/core/` | Parser, reference extraction, indexer, schema validation, lint |
| `src/cli/` | The `constellation` binary (`lint`, `init`, `mcp`) |
| `src/mcp/` | MCP server: hydrated retrieval, validated writes, git tools |
| `examples/constellation/` | Golden sample plan — one card of every type, lints clean, doubles as the test fixture |

## Development

```sh
npm install
npm test                 # vitest
npm run lint:examples    # lint the golden plan
npm run build            # tsc → dist/
```

## MCP

`constellation mcp` exposes the plan to AI agents over stdio:

- **Hydrated retrieval**: `get_card`, `search`, and `traverse` can return
  connected cards with their complete frontmatter and body in one call.
- **Validated writes**: `create_card`, `update_card`, `delete_card`,
  `add_connection`, `remove_connection` — every write lints and returns issues.
  Body-only updates never reformat frontmatter.
- **Git-powered change tracking**: `diff_plan` (per-card changes since the sync
  marker), `plan_log`, `set_sync_point`, `check_integrity`.

```json
{
  "mcpServers": {
    "constellation": {
      "command": "constellation",
      "args": ["mcp"],
      "cwd": "/path/to/your/repo"
    }
  }
}
```

Set `cwd` to your repo root (or any folder inside it). The server finds the plan by
walking up from its working directory; without `cwd` it inherits the client's, which
may not be your project — in which case tools return `NO_PLAN_FOUND`.

## Viewer

`constellation serve` renders the plan as a local website, **editable in place**
(pass `--readonly` to disable writes). Five themes toggle in the header:
**observatory** (dark, star-field), **claw** (cream paper, serif, coral accents),
**black**, **synthwave**, and **sumi**. Card pages show structured fields, the
markdown body, connection chips in both directions, and a small constellation
diagram of the card's neighborhood — its nodes tinted by card type. Mermaid blocks
render in-browser, `[[HANDLE]]` links navigate, and the page live-reloads when plan
files change on disk.

```sh
npm run build:viewer    # build the static viewer assets (once)
constellation serve     # http://localhost:4747
```

## Roadmap

- Migration script for v1 (server-based) Constellation projects.
