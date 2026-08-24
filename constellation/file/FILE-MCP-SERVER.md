---
name: mcp/server.ts
status: verified
path: src/mcp/server.ts
language: typescript
summary: 'The MCP server: tools + INSTRUCTIONS'
connections:
  - FILE-CODE
  - FILE-GIT
  - FILE-WRITER
  - FILE-SYNC
  - FILE-STALE
verified_at: '2026-08-18T17:56:52.970Z'
verified_sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
notes:
  - kind: state
    text: >-
      Code-root round: set_verified's dirty-bound-file warning translates paths through the
      code-root prefix so it actually fires in a monorepo (verified_sha stays repo-wide HEAD);
      orient's connected_repos rows now include reachable (via listConnectedRepos); NO_PLAN_FOUND
      mentions that plans can live at packages/<name>/constellation (repo=<path or name>) while
      keeping the init_plan {path} and constellation init hints. See DECISION-MONOREPO-CODE-ROOT.
---

`constellation mcp` (stdio). Registers every tool, embeds the agent-facing `INSTRUCTIONS` string (one of the three guidance copies), and resolves the target plan — the home plan or, when `repo` is passed, a connected sibling. The server handshake version is the package version (same source as the CLI), not a hardcoded leftover.

Hydration is capped where it grows without bound: `get_card` / `assemble` return each card's newest 5 notes (`notes_limit`, `0` = all) and report the omitted count as `notes_truncated`. That is **response shaping only** — the writer never touches a note stream on a read, so the file still holds the whole diary and `list_notes` still answers over all of it.

Card text has the same discipline, in one place: a per-response `Hydrator` ledger. A card's full frontmatter + body is emitted **at most once per response** (repeats become summaries with `hydrated_elsewhere: true`); DIAGRAM cards and `PLAN-PROJECT` are never hydrated *as neighbors* (`degraded_to_summary: "supernode"`) though asking for them directly still returns everything; and `HYDRATION_PER_CARD_MAX` / `HYDRATION_TOTAL_MAX` (24 KB / 96 KB, mirroring [[FILE-CODE]]'s file caps) degrade the rest to summaries rather than truncating. Whatever was held back is listed in `hydration_budget`. The explicitly requested card is exempt from every cap.

`orient` is the session-start read: it composes the index, `computeStaleCards`, the note streams and [[FILE-SYNC]]'s `packageVersion` into one unhydrated briefing, and compares that workspace version against the server's own `PACKAGE_VERSION` to flag a published-server-vs-unreleased-tree mismatch. Note ordering is by card-file mtime then append order, because notes carry no timestamp.

The handshake `instructions` are computed per boot, not fixed: `createServer` resolves the plan first and `bootInstructions` appends the one-time upgrade-review paragraph when that plan carries no `format_review` stamp ([[FILE-GIT]]). The exported `INSTRUCTIONS` constant is unchanged by this — it stays the static 55-line budget the guidance test pins ([[AGENT-GUIDANCE]]) — and no plan, or any error resolving one, falls back to it. `orient` repeats the same condition as `upgrade_review_pending` + a one-line hint, because a host that truncates the handshake would otherwise swallow the notice.

`delete_card` refuses `PLAN-PROJECT` (`plan.md` is the plan root). `set_verified`'s dirty-tree warning uses the same directory-overlap rule as [[FILE-STALE]] — a bound folder lights up when a file under it is uncommitted. `assemble` units treat a folder binding as overlapping every path inside it, so fan-out cannot hand the same files to two agents.
