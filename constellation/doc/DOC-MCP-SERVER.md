---
name: MCP server design
kind: reference
status: built
notes:
  - kind: state
    text: >-
      2026-07-14: server INSTRUCTIONS gained the note-stream HYGIENE paragraph — agents should
      RECOMMEND compaction in one line when a card's notes exceed ~10 or a later note
      supersedes/resolves an earlier one (never auto-compact, never derail the task); compaction
      itself folds still-true state notes into the body, deletes superseded interim notes, keeps
      unresolved gotchas / negative results / newest verified stamp / cross-cited notes, appends a
      "compacted at <sha>" marker, and exempts DECISION cards. The full checklist lives in the new
      "Compaction — keeping note streams lean" section of skill/SKILL.md (whose frontmatter
      description now names compaction as a trigger). Motivated by real bloat in the puzzle repo's
      plan: COMPONENT-ROUTER at 21 notes with superseded pairs a reader must reconcile
      chronologically.
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
in the server — one of three guidance copies, see [[AGENT-GUIDANCE]].

## Hydrated retrieval

Any read tool can return connected cards with full data in one call — `connected: none |
summary | full`. The acceptance test: one `get_card` returns an API card plus the complete
content of every card connected to it (its datatypes, table, tests, docs).

## Tool surface

- **Read** — `get_card` (+ `code: none|paths|direct`, notes filters), `list_cards`,
  `list_notes` (cross-card notes query by kind/handles), `search` (AND across terms over
  bodies, notes **and** the binding frontmatter — `summary`, `path`, `code_refs`),
  `traverse`, `assemble`, `describe_type` (the type reference, plan-independent).
  `list_cards`/`traverse` filter by status (value or list; `"none"` = unset), so
  `["planned","building","none"]` is the backlog view. On `traverse` status is a
  *post-filter* — the walk passes through non-matching cards so a built hub never hides
  planned work — while `types` prunes the walk itself.
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
