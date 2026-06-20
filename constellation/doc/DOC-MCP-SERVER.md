---
name: MCP server design
kind: reference
status: built
---

# MCP server

`constellation mcp` (stdio) gives AI agents graph queries, hydrated retrieval, validated
writes, and git-powered change tracking over a plan folder. It is a thin layer over
[[FILE-MCP-SERVER]] + `src/core/`: every tool call reloads the index from disk (tens of ms at
realistic sizes), so it is always correct while files are edited in parallel — no watcher, no
cache invalidation. Bootstrap is folder discovery, bounded by the repo root ([[FILE-RESOLVE]]);
a repo with no plan returns `NO_PLAN_FOUND`. The agent-facing INSTRUCTIONS string is embedded
in the server — one of three guidance copies, see [[AGENT-GUIDANCE]].

## Hydrated retrieval

Any read tool can return connected cards with full data in one call — `connected: none |
summary | full`. The acceptance test: one `get_card` returns an API card plus the complete
content of every card connected to it (its datatypes, table, tests, docs).

## Tool surface

- **Read** — `get_card` (+ `code: none|paths|direct`, notes filters), `list_cards`, `search`,
  `traverse`, `assemble`, `describe_type` (the type reference, plan-independent).
- **Write** — `create_card`, `create_cards` (batched, lints once), `update_card` (+ `if_mtime`
  stale-write guard), `append_note`, `edit_section`, `set_verified`, `delete_card`,
  `add_connection`, `add_connections`, `remove_connection`. Every write reloads + lints and
  returns the issues for the file it touched; **a card is created even when issues come back**
  (issues are lint state, not failure).
- **Git** — `diff_plan`, `plan_log`, `set_sync_point`, `stale_report`, `check_sync`,
  `check_integrity` (see [[DOC-CHANGE-TRACKING]]).
- **Viewer** — `start_viewer` / `stop_viewer` ([[PAGE-VIEWER-HOME]]).
- **Connected repos** — `list` / `add` / `remove_connected_repo`; every tool takes a `repo`
  selector (see [[DOC-CONNECTED-REPOS]]).

## Code binding, drift & assembly

A card binds to code via a connected FILE `path:` or its own `code_refs`, resolved by
[[FILE-CODE]]. `get_card(code:"paths"|"direct")` attaches it (capped, repo-contained);
`stale_report` / `check_sync` flag reverse drift; `assemble` builds file-disjoint work packages.
Byte-preserving cheap writes ([[FILE-WRITER]]) make a correction cost less than a full rewrite.

## What v1 tools deliberately died

`expand_handles` (handles ARE the identifiers); `init_project` / `link_project` /
`check_health` (bootstrap is finding a folder — `init_plan` just creates it);
`read_plan` / `update_plan` (use `get_card("PLAN-PROJECT")` / `update_card`). Bulk variants were
kept: `create_cards` / `add_connections` batch and lint once so intra-batch references resolve.
