# Constellation

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
constellation repos         # list sibling repos declared in connected_repos
constellation version       # print the CLI version (`v` also works)
constellation upgrade       # npm install -g @magic-spells/constellation@latest
```

Lint errors (broken graph: bad handles, dangling structured references,
duplicates) exit non-zero for CI; warnings (wrong folder, schema violations,
unknown fields, dangling prose links) don't block.

## Repo layout

| Path | What |
|---|---|
| `constellation/` | Constellation's own plan — the format spec, MCP design, and architecture as connected cards (formerly `docs/`); also a flagship real-world plan |
| `schemas/` | JSON Schemas: `card.json` (reserved keys) + one per type |
| `skill/` | AI authoring skill: `SKILL.md` + per-type references with golden examples |
| `src/core/` | Parser, reference extraction, indexer, schema validation, lint |
| `src/cli/` | The `constellation` binary (`init`, `lint`, `mcp`, `serve`, `repos`) |
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
- **Connected repos (multi-repo)**: a plan can declare sibling repos
  (`add_connected_repo` / `list_connected_repos` / `remove_connected_repo`); every
  tool takes an optional `repo` selector to read or write a sibling's plan. Omit it
  and single-repo behavior is unchanged.
- **Visual viewer**: `start_viewer` / `stop_viewer` open and close the local web
  viewer from inside an agent session, returning a clickable URL.

### Add to Claude Code

Run from your repo root, so the server starts there and finds the plan:

```sh
# Run straight from npm — no install needed:
claude mcp add constellation -- npx -y @magic-spells/constellation mcp

# Or, if installed globally (npm i -g @magic-spells/constellation):
claude mcp add constellation -- constellation mcp

# Share with everyone who clones the repo (writes .mcp.json):
claude mcp add --scope project constellation -- npx -y @magic-spells/constellation mcp
```

Manage it with `claude mcp list`, `claude mcp get constellation`, and
`claude mcp remove constellation`.

To build a plan from an existing codebase (or audit one), ask the agent to bootstrap or
audit — the server ships **`bootstrap_plan`** and **`audit_plan`** prompts (slash commands
in Claude Code) that walk the code macro→micro: follow the data, follow the user/auth, then
step back and pressure-test the plan for blind spots (missing unhappy paths, auth gaps,
forgotten cross-cutting concerns) and recommend. The full method is in
[`skill/methodology.md`](skill/methodology.md).

### Add to Codex

Codex CLI keeps MCP servers in `~/.codex/config.toml` (TOML, not JSON). Add it with the CLI:

```sh
# Run straight from npm — no install needed:
codex mcp add constellation -- npx -y @magic-spells/constellation mcp

# Or, if installed globally (npm i -g @magic-spells/constellation):
codex mcp add constellation -- constellation mcp
```

…or hand-edit the config (a project-scoped `.codex/config.toml` also works in trusted repos):

```toml
[mcp_servers.constellation]
command = "npx"
args = ["-y", "@magic-spells/constellation", "mcp"]
cwd = "/path/to/your/repo"   # so the server walks up to your plan
```

Launch `codex` from your repo root (or set `cwd` above) so the server starts there and finds
the plan — otherwise tools return `NO_PLAN_FOUND`. Run `/mcp` inside a Codex session to confirm
it's connected; manage it with `codex mcp list` and `codex mcp remove constellation`.

### Other MCP clients

Hand-edit the client's config (Claude Desktop, a project `.mcp.json`, etc.):

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
(pass `--readonly` to disable writes). Nine themes toggle in the header:
**observatory** (dark, star-field), **claw** (cream paper, serif, coral accents),
**black**, **synthwave**, **sumi**, **daylight**, **frost**, **ember**, and **corona**.
Card pages show structured fields, the
markdown body, connection chips in both directions, and a small constellation
diagram of the card's neighborhood — its nodes tinted by card type. Mermaid blocks
render in-browser, `[[HANDLE]]` links navigate, and the page live-reloads when plan
files change on disk.

```sh
constellation serve     # http://localhost:4747 (assets ship prebuilt with the package)
npm run build:viewer    # only when developing from source
```

In an agent session you don't need the CLI — ask Claude to open the viewer and it
calls the `start_viewer` MCP tool, which returns the URL (`stop_viewer` closes it).

---

<p align="center">
  Made by <a href="https://github.com/coryschulz">Cory Schulz</a>
</p>
