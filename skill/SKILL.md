---
name: constellation
description: Author and edit Constellation plan cards — markdown files in a constellation/ folder that model a project's architecture as a typed, connected graph. Use when creating, updating, or querying cards (API endpoints, data types, DB tables, flows, pages, etc.) in any repo with a constellation/ directory, or when setting up a plan in a repo that has none yet.
---

# Constellation cards

A Constellation plan is a folder of markdown files. Each file is one **card** — one
typed piece of the plan, linked to other cards by **connections**. Filenames are
identities, frontmatter is structure, the body is prose, and git is the
change-tracking system.

## The one rule that matters most

**The filename is the handle.** `constellation/api/API-TICKETS.md` defines the card
`API-TICKETS`. The prefix (before the first dash) determines the type. Never put
`handle:` or `type:` in frontmatter.

Handle grammar: `^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$` — uppercase letters, digits,
dashes only. No underscores, no lowercase.

## Types, prefixes, folders

| Prefix       | Folder       | Use for                          | Reference            |
|--------------|--------------|----------------------------------|----------------------|
| `API-`       | `api/`       | HTTP/RPC endpoints               | `types/api.md`       |
| `DB-`        | `db/`        | Tables / collections             | `types/db.md`        |
| `DATATYPE-`  | `datatype/`  | Type schemas                     | `types/datatype.md`  |
| `ROLE-`      | `role/`      | Roles / permissions              | `types/role.md`      |
| `DOC-`       | `doc/`       | Documentation, rules, decisions  | `types/doc.md`       |
| `FILE-`      | `file/`      | Source file references           | `types/file.md`      |
| `TEST-`      | `test/`      | Test specs                       | `types/test.md`      |
| `EXTERNAL-`  | `external/`  | External services                | `types/external.md`  |
| `EVENT-`     | `event/`     | Domain events                    | `types/event.md`     |
| `COMPONENT-` | `component/` | UI components                    | `types/component.md` |
| `PAGE-`      | `page/`      | Routes / screens                 | `types/page.md`      |
| `JOB-`       | `job/`       | Background / scheduled work      | `types/job.md`       |
| `FLOW-`      | `flow/`      | Step-by-step processes           | `types/flow.md`      |
| `STATE-`     | `state/`     | State machines                   | `types/state.md`     |
| `DIAGRAM-`   | `diagram/`   | Architecture diagrams            | `types/diagram.md`   |
| `AGENT-`     | `agent/`     | AI agent instructions            | `types/agent.md`     |
| `PLAN-`      | `plan/`      | Plan docs (`plan.md` at root = `PLAN-PROJECT`) | `types/plan.md` |

Read the matching `types/<type>.md` before writing a card of a type you haven't
authored in this session — it has the field table and a golden example.

## Frontmatter

Four reserved keys, all optional. Everything else is a type-specific field (see the
type reference). Don't invent fields when the type reference defines one for the
purpose — but unknown extra fields are allowed (lint warns, doesn't fail).

```yaml
name: List & create tickets        # display label (handle is the identity)
kind: sql-table                    # lowercase-slug subtype, when the type has variants
status: built                      # planned | building | built | verified
connections:                       # plain list of handles — no kinds, no direction
  - DB-TICKETS
```

## Connections — how the graph gets wired

Connections are undirected and come from four places; all count equally:

1. The `connections:` list.
2. Any handle-shaped value in other frontmatter fields (`response_schema: DATATYPE-TICKET`
   connects automatically — don't repeat it in `connections`).
3. `[[HANDLE]]` wiki-links in the body — use these freely in prose; they're the
   cheapest way to connect cards.
4. Handle-shaped node IDs inside ```mermaid blocks.

Declare a connection on whichever card you're editing — the other card sees it via
the index. Never edit two cards just to record one connection.

**Frontmatter references must resolve** (lint error if the target card doesn't
exist). Body `[[links]]` may point at cards not yet written (lint warning only) —
that's how you mark future work.

## Body conventions

- DATATYPE: the type declaration as a fenced code block (```ts).
- FLOW: a numbered markdown list of steps; nested items for error/edge branches.
  If it genuinely branches, it's a Mermaid flowchart or a STATE card instead.
- STATE: a ```mermaid stateDiagram-v2 block.
- DIAGRAM: a ```mermaid flowchart with **handles as node IDs** so the diagram joins
  the graph.
- Everything else: prose with `[[links]]`. Put relationship nuance in prose, not
  in structure.

## Bootstrapping & auditing a plan

Act as a senior engineer and architect advising the user, not a scribe — don't assume they
know everything; bring expertise, flag risks, propose what's missing, and hold a high bar
with integrity (honest about built-vs-planned and verified-vs-assumed). But don't
over-engineer — there's elegance in simplicity: calibrate to the project's scope and
recommend the smallest change that most improves the plan. The goal is a plan they'd be
proud to ship — and the bar above all: if the code were deleted, the app could be rebuilt
from the plan alone (coverage, not volume).

No `constellation/` folder yet? Create one — `init_plan` (MCP) or `constellation init`
(CLI) — then build the plan from the code, working **macro→micro**:

1. **Orient** — manifest, routes, folder layout. Seed `PLAN-PROJECT` + one system `DIAGRAM`.
   Propose a human-readable project name (folder `pyramid-server` → `Pyramid Server`) and
   confirm it with the user — it's `plan.md`'s `name:` and the viewer's title; editable anytime.
2. **Follow the data** — `DB → DATATYPE → API → PAGE`; paths become `FLOW`, lifecycles `STATE`.
3. **Follow the user** — `ROLE` + auth `FLOW` first, then `PAGE`/`COMPONENT` and key journeys.
4. **Follow the edges** — `EXTERNAL`, `JOB`, `EVENT`.
5. **Zoom in** — detail only central or complex areas.
6. **Ask** — only for intent, priorities, and history the code can't reveal.
7. **Find gaps in the plan** — step back and hunt blind spots the user may not have
   considered: missing unhappy paths/states, auth gaps, forgotten cross-cutting concerns
   (security, privacy, observability, rate limits, pagination, migrations, testing). Plus a
   quick mechanical sweep: `check_integrity` orphans, dangling refs, code-without-cards.
8. **Recommend** — a short, prioritized list, separating "you likely forgot this" from
   "consider whether you need this"; speculative cards go in as `status: planned`.

Reverse-engineering shipped code: default cards to `built`, promote to `verified` only
after checking against the implementation. **The full method — what to read, what to ask,
how to find gaps and recommend tastefully — is in [`methodology.md`](./methodology.md),
which also backs the `bootstrap_plan` / `audit_plan` MCP prompts.** Read it before a large
pass.

**Orchestrate a large build.** For a non-trivial plan, after the macro pass act as the **orchestrator**: split the work into independent neighborhoods (the data, the user, the edges) and fan out a sub-agent per neighborhood in parallel — assign each card to exactly one agent (one handle = one file, so this also keeps writes to disjoint plan files and concurrent `update_card`s can't clobber), partition the research on area/file boundaries, and have them return card specs you write via batched `create_cards`/`add_connections`, then verify each agent's work and lint once. A single agent for a small plan — don't over-engineer.

## Changing code: plan-first

When the user asks to build a feature or change behavior in an area the plan covers, the
plan **is** the spec — so do **not** edit code first. The plan you make leads with
Constellation:

1. **Read the neighborhood** — `get_card` / `traverse` / `search` (`connected: "full"`) the
   cards the change touches, so you work from the real architecture, not a guess.
2. **Express the end state in the plan** — add or update the cards (and `plan.md`) so they
   describe what you're about to build, wiring every connection between the affected cards.
   Work that doesn't exist yet is `status: planned` — honest intent, not a claim it's built.
3. **Get sign-off on the plan diff** — show the user that set of card changes as the
   proposal (`git diff -- constellation/` is the diff). The plan is what they approve.
4. **Then bring the code up to match** — via the sync loop below.
5. **Reconcile at the end** — re-read the touched cards against the code, run
   `check_integrity` to confirm no affected card is left an orphan and every intended
   connection is set, bump `status` (`planned → building → built → verified`), commit, and
   `set_sync_point`.

**In plan mode, read as much of the plan as you can.** The write tools are unavailable there
by design (the read tools — `get_card`, `list_cards`, `search`, `traverse`, `describe_type`,
`check_integrity`, `diff_plan`, `plan_log` — are marked read-only and stay available). Spend
plan mode pulling the relevant plan into context — `traverse` from the entry points with
`connected: "full"` — to build a strong model of the project fast, and fold the card edits
you intend into the plan you present. Execute those Constellation writes first, before any
code, once the user approves.

## Syncing the plan to code

The plan is the source of truth: you change behavior by editing the **plan first**, then
bringing the code up to match — never the reverse. When the user says "sync the plan" or
"sync the plan to the code," they mean this loop (not merely stamping the sync marker):

1. **Diff the plan** — `diff_plan` (base = the `.sync.json` marker, else `HEAD`) lists the
   cards added / modified / removed since code was last reconciled, with the changed
   frontmatter keys and bodies.
2. **Find the blast radius** — `traverse` the changed handles (`detail: "full"`) to pull in
   every connected card the change touches: the `API` a `DATATYPE` feeds, the `PAGE`s a
   `FLOW` crosses, the `DB` a migration implies.
3. **Update the code** to match those cards — contracts, schemas, routes, states, flows.
4. **Verify and mark** — run the project's build/tests, bump card `status` as code lands
   (`planned → building → built`), then commit and `set_sync_point` to advance the marker.

**Orchestrate large syncs.** When the diff is large and the affected areas don't share
files, act as the **orchestrator** instead of editing everything yourself: partition the
blast radius into independent neighborhoods and hand each to a sub-agent working in
parallel, each given its hydrated cards and the files it owns. Split only along clean file
boundaries so two agents never edit the same file, **and assign each card to exactly one
agent** — two agents writing the same card (e.g. a shared `DATATYPE` both neighborhoods
touch) race, and the later `update_card` silently clobbers the earlier. Keep it to a single
agent when the change is small or the areas overlap. Delegating this way keeps your own context clean and lets you
hold the macro view of the whole change rather than drowning in file-level edits.

**Always verify the agents' work yourself once they have all finished** — re-read each
change against the cards it was meant to satisfy and run the project's build/tests; never
trust the sub-agents' reports alone. Only after that whole-plan verification passes do you
commit and `set_sync_point` (once, as the orchestrator).

## Connected repos (multi-repo work)

One change often spans several sibling repos (e.g. `pyramid-web`, `pyramid-server`,
`pyramid-mcp`). Constellation models this with **repo-level links**, not cross-repo card
connections: each project lists its siblings in `PLAN-PROJECT` frontmatter, and every plan
stays self-contained and lints on its own.

```yaml
# plan.md (PLAN-PROJECT) frontmatter
connected_repos:
  - name: pyramid-server          # the `repo` selector value (lowercase id)
    path: ../pyramid-server       # relative to this repo's root
    description: Back-end API for Pyramid, written in Go.
```

- **Declare** links with `add_connected_repo` (`reciprocate: true` also writes the reverse
  link into the other repo — only with the user's OK, since it edits that repo). List them
  with `list_connected_repos` or `constellation repos`; remove with `remove_connected_repo`.
  Paths are local topology — a missing path is never a lint error, just "not reachable here."
- **Target** a connected repo by passing `repo: "<name>"` to any read or write tool
  (`get_card`, `search`, `traverse`, `update_card`, `create_card`, `set_sync_point`, …); it
  reads/writes THAT repo's plan. Omit `repo` for the current one — single-repo work is
  unchanged.
- **Answer cross-repo questions two ways.** For "what does the back end's plan say," read it
  in-process with `repo:`. For "how does the back end actually work" — real code, or the
  connected plan can't answer — spawn a **sub-agent scoped to that repo's path** to
  investigate and report back, and if its plan had the gap, have it fill the gap.
- **One change across repos:** examine each repo's affected area (`repo:` reads), write the
  per-repo card updates with `repo:` set on **every** write (never omit it cross-repo, or the
  write lands in the wrong repo), then fan out a per-repo implementer sub-agent — each runs
  in plain single-repo mode inside its repo, blind to the others — and reconcile +
  `set_sync_point` per repo.

Cards never connect across repos; the relationship between repos lives in the
`connected_repos` links and in your reasoning, not in card connections.

## Workflow

1. Before creating a card, check it doesn't exist: the filename is deterministic,
   so look up `constellation/<folder>/<HANDLE>.md`; grep for the handle to find
   prose references.
2. Write or edit the card.
3. Verify: `npx constellation lint` (errors break the graph and must be fixed;
   warnings are quality signals).
4. Update `status` when reality changes: `planned → building → built`, and
   `verified` only after checking the card against the actual code.
5. Never bulk-rewrite `constellation/plan.md` — edit the relevant section.
   Decisions go in DOC cards (`kind: decision`), one file each, not in the plan.

"What changed in the plan" is never tracked in cards — that's
`git diff -- constellation/`. Don't add dirty flags, changelogs, or timestamps to
frontmatter.
