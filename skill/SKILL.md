---
name: constellation
description: Author and edit Constellation plan cards — markdown files in a constellation/ folder that model a project's architecture as a typed, connected graph. Use when creating, updating, or querying cards (API endpoints, data types, DB tables, flows, pages, etc.), when compacting a card whose note stream has grown stale or repetitive, in any repo with a constellation/ directory, or when setting up a plan in a repo that has none yet.
---

# Constellation cards

A Constellation plan is a folder of markdown files. Each file is one **card** — one typed
piece of the plan, linked to other cards by undirected **connections**. Filenames are
identities, frontmatter is structure, the body is prose, and git is the change-tracking
system.

**The MCP server is the interface.** It carries the always-on rules and serves the type
reference; this file is the deeper reference behind them.

- `describe_type` — the field table and golden example for any of the 21 types. Call it
  instead of memorizing types; no args gives the catalog.
- [`methodology.md`](./methodology.md) — building or auditing a whole plan from a codebase:
  the architect stance, macro→micro, gap-finding, orchestration. Read it before any large
  pass, and whenever a repo has no `constellation/` folder yet — when tools return
  `NO_PLAN_FOUND`, call `init_plan` once; never create the folder or hand-write `plan.md`
  yourself.
- No MCP server connected? See *Working without MCP* at the end.

## Why it exists: durable cross-session memory

The plan is memory you share with every past and future agent, not docs you skim. Before
changing code an area's cards cover, read those cards. After changing that code, bring the
cards back into line — that's part of "done," like updating tests. Understanding then
compounds across sessions instead of being re-derived, but only if the cards stay true, so
**a card you can't trust is worse than no card.**

The bar to hold a card to: **a later agent can change this area without rediscovering the
why, the gotchas, and the contracts.** That's what decides whether a card earns its tokens.
So put in cards what code can't say — intent, decisions and rejected alternatives, current
state, gotchas, cross-cutting rules — and never duplicate DDL, signatures, or code that
lives in the repo; link to it, because copies drift. Never create index cards that
enumerate other cards (a `DOC-DECISIONS` listing every DECISION, a type table of contents):
those are derived views `list_cards` / `search` / the viewer produce live; delete any you
find.

## The one rule that matters most

**The filename is the handle.** `constellation/api/API-TICKETS.md` defines the card
`API-TICKETS`; the prefix before the first dash is the type. Never put `handle:` or `type:`
in frontmatter. Handle grammar: `^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$` — uppercase, digits,
dashes. `plan.md` at the plan root is the one exception: its handle is `PLAN-PROJECT`.

## All card writes go through MCP

The rule: all card writes go through the Constellation tools; never edit a card file
directly — hand-edits invent fields and formats the schema doesn't support, feeding bad
data to the viewer and to every future agent that loads the plan.

The writers: `create_card` / `create_cards`, `update_card`, `edit_section`, `append_note`,
`add_connection` / `add_connections`, `remove_connection`, `set_verified`, `rename_card`,
`delete_card`. They validate against the schema, reject reserved keys in `fields`,
serialize predictably, and lint on every write, returning the issues for the file they
touched — a card is still written when issues come back (issues are lint state, not
failure).

**When a write fails, don't route around it.** When a write tool errors (STALE, NOT_FOUND,
a reserved-key rejection, a timeout), re-read the card and retry, or report the failure —
never fall through to editing the file. The file-edit path exists only when no server is
connected at all (below).

### What each write costs

- **`append_note` and `edit_section` are byte-preserving** — `append_note` appends one typed
  note (`decision` | `gotcha` | `state` | `deviation` | `verified`); `edit_section` replaces
  a single `##` section and leaves every other byte alone. These are the everyday writes:
  record a correction the moment you learn it instead of saving it for a full rewrite.
- **`update_card` is coarser — know its patch semantics.** `patch.name` / `kind` / `status`
  set (or delete with `null`). `patch.fields` **deep-merges** into type-specific
  frontmatter: nested objects merge, **arrays replace wholesale**, and `null` deletes a key.
  `patch.connections` **replaces** the entire list. `body` **replaces the entire body** —
  there is no partial body patch, so send the complete body or use `edit_section`. Only the
  top-level frontmatter keys whose values actually changed are re-serialized, and a
  body-only update never reformats frontmatter; but "byte-preserving" describes the cheap
  writes, not an `update_card` that rewrites a body or a connections list.
- **Never bulk-rewrite `plan.md`.** It's the biggest card in most plans and the one every
  session reads. Use `edit_section` on the one section that changed.
- **Batch scaffolds.** `create_cards` + `add_connections` lint once and resolve intra-batch
  references, so migrations don't emit transient "does not resolve" errors.
- **Renames are plan-wide.** `rename_card` moves the file and rewrites every reference
  (connections, frontmatter values, `[[links]]`, mermaid node IDs) as whole tokens — and
  never delete-and-recreate to rename, or hand-rename the file. For bulk changes loop the
  singular tools (CLI: `constellation rename`), never search-and-replace the plan folder.
- **`delete_card` does not clean up after itself.** It removes the file and returns
  `referenced_by` — the cards that still point at the deleted handle, now dangling E005
  errors. Fix those references (usually `remove_connection` or an `update_card` field
  patch) in the same pass.
- **`remove_connection` only strips the `connections:` list.** If the edge is also declared
  by a handle-shaped value in another frontmatter field, the cards stay connected — the tool
  tells you which source remains; clear it with a field patch. A leftover `[[link]]` or
  mermaid node ID never keeps them connected.
- **Verify:** `npx constellation lint` (errors break the graph and must be fixed; warnings
  are quality signals). `check_integrity` runs the same checks plus orphans.

## Reading

**Start with `orient`.** One call at session start returns a small read-only briefing —
what the project is, the type and status histogram, what's drifting, the newest notes
across all cards, connected repos, and a server-vs-workspace version check. It never
hydrates, so it costs a fraction of the `list_cards` + `check_sync` + `list_notes` opening
ritual it replaces. Follow it with `search` or `get_card` on whatever it points you at.

Grep on card files is allowed — but `search` is usually the better first call:

- ranked handles instead of raw matching lines;
- one call instead of grep → map paths → `get_card`;
- it covers notes, `path`/`code_refs`, and connected repos, which grep on this repo's cards
  misses.

Retrieval defaults are lean, and every default is a token decision:

- **Summaries unless you name the card.** Full content is for cards you asked for, not for
  everything within two hops of them.
- **Walks travel the connection graph**, which is frontmatter-derived (see *Connections*).
  `traverse` and `assemble` follow the relationships you declared; a `[[link]]` steers
  nothing.
- **`assemble` returns an index.** `hydration: "index"` (the default) gives units, seeds,
  bound paths and neighbor summaries with no bodies — read the index, then pull the three
  or four cards a unit actually needs. `hydration: "full"` restores hydrated neighbors under
  the dedupe and budget rules below.
- **Hydration never truncates silently.** A card is spelled out at most once per response
  (repeats come back as summaries with `hydrated_elsewhere`), DIAGRAM cards and
  `PLAN-PROJECT` never hydrate as *neighbors* (asking for them directly still returns
  everything), and anything past the byte budget degrades to a summary rather than being
  cut mid-card. Everything held back is named in `hydration_budget` and refetchable by
  handle.
- **Flat lists page.** `search`, `list_cards` and `list_notes` take `limit` + `offset` and
  report `total` (`total_hits` for search) plus `more` and the `next` offset. Page through
  rather than raising `limit` blindly — and never read a truncated page as the whole answer.
- **Notes come back newest-first and capped** (`notes_limit`, with `notes_truncated` naming
  what was held back). `list_notes` reads the whole stream across cards by kind — every
  gotcha or decision in one call. `get_card code: "paths" | "direct"` returns the code a
  card is bound to (connected FILE `path:` plus its own `code_refs`).

## Frontmatter

Four reserved keys — `name`, `kind`, `status`, `connections` — all optional. Everything else
is a type-specific field (`describe_type`), and type-specific `fields` may not reuse a
reserved key. Unknown extra fields are allowed but warn (W003).

```yaml
name: List & create tickets        # display label (handle is the identity)
kind: sql-table                    # lowercase-slug subtype, when the type has variants
status: built                      # planned | building | built | verified
connections:                       # plain list of handles — no kinds, no direction
  - DB-TICKETS
```

A few **cross-type metadata fields** are valid on any card but tool-managed, not
hand-authored: `code_refs` (extra bound code — `path` or `path:symbol`), `verified_sha` /
`verified_at` (`set_verified`), and `notes` (`append_note`).

Author in the types the plan already uses. A plan with a settled palette stays readable;
importing a new type for one card usually doesn't earn it.

## Connections

**Connections come only from frontmatter** — the `connections:` list and handle-shaped
values in other frontmatter fields (`response_schema: DATATYPE-TICKET` connects — don't
repeat it). **A prose `[[link]]` is a hyperlink and a pointer for readers, never an edge**:
so is a handle used as a mermaid node ID. Put every relationship you want the graph to know
in `connections:` — the API a FLOW crosses, the DATATYPE a table materializes, the FILE a
DOC specifies. Connections are undirected: declare one on whichever card you're editing and
the other side sees it via the index; never edit two cards to record one connection.

**Structured refs are contracts; prose refs are aspirational.** A `connections:` entry or a
handle-shaped frontmatter value pointing at a card that doesn't exist is an **error
(E005)** — it breaks the graph. A body `[[link]]` or mermaid ID with no target is only a
**warning (W004)**, because prose may legitimately point at a card not yet written; that's
how you mark future work. Keep `[[links]]` for exactly that — the aspirational and the
merely mentioned — and remember they still render as clickable links in the viewer.

### The one-time 0.5.0 format review

Prose stopped being an edge in 0.5.0, so a plan authored earlier may be holding real
relationships only in `[[links]]`. The MCP server announces that on its first run against
such a plan; the marker it reads is `format_review` in `constellation/.sync.json`, absent
until somebody reviews. When you get that notice: promote the real relationships into
`connections:`, reconnect the cards that turn out to be unintentional orphans, and compact
wordy or token-heavy cards while you're in there. Confirm the scope with the user before
large edits. Record it with `set_sync_point` (`format_review: true`) when the review is done
or the user declines, and the notice never appears again. Plans made by `init_plan` are
stamped at birth, so they never see it.

Body conventions: DATATYPE = the type declaration in a fenced block; FLOW = a numbered list
(real branching becomes a STATE card or a mermaid flowchart); STATE = `stateDiagram-v2`;
DECISION = Context / Decision / Alternatives / Consequences; everything else = prose with
`[[links]]`. Use handles as mermaid node IDs sparingly — see *DIAGRAM* in `describe_type`.

## Changing code

**Plan-first applies to behavior changes** — a new FEATURE, an API contract, a STATE change,
a new surface. There the plan is the spec:

1. **Read the neighborhood** — `get_card` / `traverse` / `search` the cards the change
   touches, so you work from the real architecture.
2. **Express the end state in the plan** — with the write tools, add or update the cards
   that describe what you're about to build, wiring the connections; if `PLAN-PROJECT`
   needs a change, `edit_section` the one section. Unbuilt work is `status: planned` —
   honest intent, not a claim.
3. **Get sign-off on the plan diff** — `git diff -- constellation/` is the proposal.
4. **Bring the code up to match**, then reconcile: re-read the touched cards against the
   code, bump `status`, and commit the cards with the code.

**Refactors, CSS, renames, dependency bumps and other non-behavioral work go straight to
code** — then fix whatever cards they made wrong. Don't stage a plan diff for work that
changes no contract.

"Sync the plan" means bringing code and cards into agreement — not stamping a marker, and
not rewriting cards to match whatever the code happens to do. Which side moves depends on
which one is right: for a behavior change the cards lead, for an undocumented change the
cards catch up.

In plan mode the write tools are unavailable by design; the read tools stay. Spend plan mode
reading the plan, and fold the card edits you intend into the plan you present.

### Drift follows git

A card is stale when its bound code has commits newer than the card's own last commit.
Commit the card together with the code; stale_report on a dirty tree flags work in progress
— expected, not drift to fix. `set_verified` is the explicit override: it stamps
`verified_sha` / `verified_at` as the baseline to measure against (a claim about *committed*
code — it warns if the bound files are dirty), which is what makes `built` / `verified` a
re-checkable claim rather than faith. `stale_report` lists the drifted cards; `check_sync`
rolls that into one definition-of-done verdict.

"What changed in the plan" is never tracked in cards — that's `diff_plan` / `plan_log` /
`git diff -- constellation/`. No dirty flags, no changelogs in frontmatter.

**Orchestrate large changes.** When the affected areas don't share files, partition them and
fan out a sub-agent per neighborhood — split on file boundaries so no two agents edit the
same file, **and assign each card to exactly one agent** (two agents calling `update_card`
on the same card race; the later write clobbers the earlier). Always verify their work
yourself against the cards it was meant to satisfy before you call it done.

## Iterating: features & releases

- A coherent slice of future work is a **FEATURE** card connected to every card it adds or
  touches (new work `status: planned`), with intent / scope / acceptance in the body and
  `branch:` while in flight. Status is the arc: `planned` → `building` → `built` (set `pr:`
  to the merged PR as provenance) → `verified`. Shipped FEATUREs stay — they're the record
  of why the system grew.
- `change:` says how the work reads in its release — `feature` (default) / `fix` /
  `breaking` / `chore`. Set `breaking` the moment you know callers must change.
- A **RELEASE** card is a version milestone; features point at it via `release:`. Its body
  is theme plus upgrade notes, **never a changelog** — the release describes itself from the
  FEATURE cards grouped by `change:`.
- Not a ticket tracker: work that's one card's status flip needs no FEATURE card. The
  backlog is `list_cards status: ["planned", "building", "none"]`, and the viewer's Board
  view (`/board`) shows every FEATURE in its status column.

## Compaction — keeping cards lean

Every future hydration pays for a bloated card. A body should read in about a minute and
describe the **current** system, present tense. Git preserves every deleted line, so
compaction curates what agents load; it never destroys history.

**Compact opportunistically** — when you're already writing to a card and see bloat, fix it
in that write. Reserve "recommend, don't touch" for jobs big enough to derail your task, or
that would delete something on the keep-list.

**Triggers:** the note stream passes ~10 entries; a later note supersedes an earlier one;
several interim `verified` stamps predate the newest; the body narrates history ("we used
to… now we…"), describes removed behavior, or restates the code; you're about to re-stamp
`verified` after a merge (the natural moment — you've just re-read everything).

**The pass:** fold still-true `state` notes into the body (a `state` note is a delta waiting
to be merged) → **keep** unresolved gotchas, negative results (disproven hypotheses stop the
next agent from re-investigating), the newest `verified` stamp, and anything another card
cites → delete superseded interim notes, resolved gotcha/resolution pairs (fold any lasting
rule into the body first), and stale `verified` stamps → trim bloated sections with
`edit_section` down to present-tense truth → append one `state` note: "compacted at `<sha>`
— full history in git." Never rewrite a kept note's text; that's claim revision, not
compaction.

**DECISION cards compact hardest.** One card per decision topic, updated in place: when a
decision changes, rewrite it to state only the current choice and why — the abandoned
approach becomes a line in Alternatives. Never create a successor DECISION card for the same
topic; merge any supersession chain into one card. A `decision` note is for a choice local
to one card; a decision that shaped several cards gets its own DECISION card, connected to
each.

## Connected repos (multi-repo work)

Repo-level links, not cross-repo card connections: each project lists its siblings in
`PLAN-PROJECT.connected_repos` (`name` + relative `path` + `description`), and every plan
stays self-contained and lints on its own.

- Manage them with `add_connected_repo` (`reciprocate: true` writes the reverse link into
  the other repo — only with the user's OK), `list_connected_repos`, `remove_connected_repo`.
  A missing path is never a lint error, just "not reachable here."
- Pass `repo: "<name>"` to any read or write tool to target that repo's plan. Omit it for
  the current repo. On a cross-repo change, set `repo:` on **every** write or it lands in
  the wrong plan.
- For "how does the other repo actually work" — real code, not its plan — spawn a sub-agent
  scoped to that repo's path; if its plan had the gap, have it fill the gap.

## Working without MCP

If no Constellation MCP server is connected, you are the write path: edit the files
directly, follow the frontmatter rules above, keep the byte discipline (touch only what
changes), consult `types/<type>.md` in this skill folder in place of `describe_type`, and
run `npx constellation lint` after every batch. Use `constellation rename OLD NEW` for
renames — never move a card file by hand. This is the only case where editing card files is
correct; a failed write tool is not (see above). Reconnect the server when you can.

**Contributing to Constellation itself is also different.** The MCP-writes rule governs
plans consumed as project memory. If you are working *on the Constellation source repo*,
follow that repo's `CLAUDE.md`: its spec cards in `constellation/` and the golden fixture in
`examples/constellation/` are maintained as ordinary lint-gated files.

## Meta-feedback

Notice anything that would make Constellation better as you work — an awkward or missing
tool, an instruction that misled you, output that wasted context — and give the user a short
list of concrete improvements at the end of the conversation (skip it if you have none).
