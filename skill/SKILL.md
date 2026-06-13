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
