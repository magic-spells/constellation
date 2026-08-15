---
name: MCP server design
kind: reference
status: built
notes:
  - kind: state
    text: >-
      2026-07-28: DECISION cards flipped from compaction-exempt to living records — one card per
      decision topic, updated in place when the decision changes (old approach becomes a rejected
      Alternative; git holds the trail); the `supersedes` field was removed from
      schemas/decision.json. Landed in all three guidance copies (server INSTRUCTIONS, SKILL.md,
      types/decision.md) and DECISION-NATIVE-DECISION-TYPE. Motivated by real bloat: fast-iterating
      projects grew chains of ~12 superseding DECISION cards about one topic.
  - kind: state
    text: >-
      2026-07-28: compaction policy loosened from "recommend only, never auto-compact" to
      OPPORTUNISTIC — agents compact as part of any card update (or an obviously-safe fix spotted
      while exploring), and the pass now covers body bloat too (history narration, removed
      behavior, restated code), not just note streams. Recommend-only is reserved for big jobs or
      anything touching the keep-list. Updated in server INSTRUCTIONS + SKILL.md Compaction
      section (now "keeping cards lean", with a body-trim step).
---

# MCP server

`constellation mcp` (stdio) gives AI agents graph queries, hydrated retrieval, validated
writes, and git-powered change tracking over a plan folder. It is a thin layer over
[[FILE-MCP-SERVER]] + `src/core/`: every tool call reloads the index from disk (tens of ms at
realistic sizes), so it is always correct while files are edited in parallel — no watcher, no
cache invalidation. Bootstrap is folder discovery, bounded by the repo root ([[FILE-RESOLVE]]);
a repo with no plan returns `NO_PLAN_FOUND`. The agent-facing INSTRUCTIONS string is embedded
in the server — one of three guidance copies, capped at 55 lines because every session pays
for it, and held in step with the other two by `tests/guidance-consistency.test.ts`. See
[[AGENT-GUIDANCE]].

## Hydrated retrieval

Any read tool can return connected cards with full data in one call — `connected: none |
summary | full`. The acceptance test: one `get_card` returns an API card plus the complete
content of every card connected to it (its datatypes, table, tests, docs).

Hydration is **lean by construction**, because the naive version pays for the same body many
times over:

- **Deduped** — a card's full content appears at most once per response; later mentions are
  its summary with `hydrated_elsewhere: true`.
- **No supernodes as neighbors** — DIAGRAM cards and `PLAN-PROJECT` sit next to everything, so
  they degrade to summaries when *reached*; requested by name they still return in full.
- **Budgeted** — 24 KB per card, 96 KB per response (mirroring [[FILE-CODE]]'s file caps).
  Past that, remaining neighbors degrade to summaries. Nothing is ever silently truncated:
  every omission is named in `hydration_budget` (`deduped`, `degraded`, `budget_exhausted`).
- **Structured edges by default** — walks (`traverse`, `assemble`) travel `connections:` and
  frontmatter refs only; `edges: "prose" | "both"` opts `[[links]]` and mermaid IDs back in.
  `get_card` still lists *every* connection — one hop is informative — each tagged with
  `edge_sources` ([[FILE-INDEXER]] carries the provenance).

## Tool surface

- **Orientation** — `orient`: the session-start briefing, one small unhydrated response —
  plan root, PLAN-PROJECT name + summary (its `summary` field, else the body's opening prose),
  type histogram + status rollup, stale count with ~5 handles, the newest notes across the
  plan, connected repos, and the running server version against the workspace
  `package.json` (`version_mismatch` + a one-line warning catches "a published server is
  answering for an unreleased tree"). It replaces the five-tool opening ritual, so it stays
  counts-and-handles: never card bodies.
- **Read** — `get_card` (+ `code: none|paths|direct`, notes filters), `list_cards`,
  `list_notes` (cross-card notes query by kind/handles), `search` (AND across terms over
  bodies, notes **and** the binding frontmatter — `summary`, `path`, `code_refs`),
  `traverse`, `assemble`, `describe_type` (the type reference, plan-independent).
  `get_card` / `assemble` hydrate each card with its **newest 5 notes** and
  `notes_truncated: N` (`notes_limit` overrides, `0` = all) — response shaping only: the
  card file keeps every note and `list_notes` stays uncapped.
  `list_cards`/`traverse` filter by status (value or list; `"none"` = unset), so
  `["planned","building","none"]` is the backlog view. On `traverse` status is a
  *post-filter* — the walk passes through non-matching cards so a built hub never hides
  planned work — while `types` prunes the walk itself. `traverse` / `assemble` also take
  `edges: structured | prose | both` (default `structured`).
  The flat list tools — `search`, `list_cards`, `list_notes` — page statelessly on
  `limit` + `offset` (defaults 20 / 100 / 50). There are no cursors and no server state:
  the index is rebuilt from files every call, so a cursor could only lie. Truncation is
  always **self-addressed** — the response carries the full count (`total_hits` / `total`),
  the `offset`/`limit`/`returned` slice it sent, and `more: true` with the exact offset to
  ask for next.
  `assemble` is an **index** by default (`hydration: "index" | "full"`): file-disjoint units,
  seed handles, per-seed bound paths, and a deduped neighbor list — no bodies, because the
  parent then pulls the handful of cards a sub-agent actually needs with `get_card`. Its
  `depth` moves the *walk* (`reached_handles`, `neighbors`, `suggested_order`), never what
  gets serialized: `hydration: "full"` spells out each seed plus its **direct** connections.
- **Write** — `create_card`, `create_cards` (batched, lints once), `update_card` (+ `if_mtime`
  stale-write guard), `append_note`, `edit_section`, `set_verified`, `rename_card` (rename a
  handle and rewrite every reference plan-wide, whole-token; the file moves with the prefix —
  shared engine with the CLI `constellation rename`, [[FILE-RENAME]]),
  `delete_card`, `add_connection`, `add_connections`, `remove_connection`. Every write reloads
  + lints and returns the issues for the file it touched; **a card is created even when issues
  come back** (issues are lint state, not failure). Writes are serialized per file behind an
  in-process lock and land atomically (temp + rename); the cheap writes apply their change to
  the file's *current* content, so concurrent small updates compose instead of clobbering.
- **Git** — `diff_plan`, `plan_log`, `set_sync_point`, `stale_report`, `check_sync`,
  `check_integrity` (see [[DOC-CHANGE-TRACKING]]).
- **Viewer** — `start_viewer` / `stop_viewer` ([[PAGE-VIEWER-HOME]]).
- **Connected repos** — `list` / `add` / `remove_connected_repo`; every tool takes a `repo`
  selector (see [[DOC-CONNECTED-REPOS]]).

## Code binding, drift & assembly

A card binds to code via a connected FILE `path:` or its own `code_refs`, resolved by
[[FILE-CODE]]. `get_card(code:"paths"|"direct")` attaches it (capped, repo-contained);
`stale_report` / `check_sync` flag reverse drift — each claim card measured against its
`verified_sha`, else its own last commit, else base/marker ([[FILE-STALE]]);
`assemble` builds file-disjoint work packages.
Byte-preserving cheap writes ([[FILE-WRITER]]) make a correction cost less than a full rewrite.

## What v1 tools deliberately died

`expand_handles` (handles ARE the identifiers); `init_project` / `link_project` /
`check_health` (bootstrap is finding a folder — `init_plan` just creates it);
`read_plan` / `update_plan` (use `get_card("PLAN-PROJECT")` / `update_card`). Bulk variants were
kept: `create_cards` / `add_connections` batch and lint once so intra-batch references resolve.
