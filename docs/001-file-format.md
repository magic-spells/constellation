# Constellation File Format (v2)

Constellation stores a project's architecture plan as markdown files in the repo, under a
`constellation/` folder. Each file is one **card** — one typed piece of the plan,
linked to other cards by **connections**. ("Node" is reserved for diagram elements
inside DIAGRAM cards; everything else is a card.)
Git provides branching, diffing, merging, and history for the plan; the Constellation
tooling (lint, MCP, viewer) provides validation, graph queries, and rendering on top.

This document is the normative format spec. The JSON Schemas in `schemas/` define the
per-type frontmatter fields; the skill in `skill/` teaches AI agents to author cards.

## Design principles

1. **The files are the source of truth.** Everything else — reverse indexes, catalogs,
   rollups, subgraph diagrams, diffs — is derived in memory and never stored.
2. **A card with no frontmatter is valid.** The file path gives identity; the body gives
   content. All structure is opt-in.
3. **Git is the change-tracking system.** `git diff -- constellation/` *is* the plan diff.
   Lifecycle state (`status`) is a property of a card; "what changed" is a property of
   history — the format never conflates them.
4. **Cheap to connect.** Connections are a plain list of handles. Friction on
   connecting cards produces sparse graphs, and a sparse graph is useless.

## Folder layout

```
constellation/
  plan.md              ← the project plan (handle PLAN-PROJECT)
  api/
    API-TICKETS.md
  datatype/
    DATATYPE-TICKET.md
  db/
    DB-TICKETS.md
  doc/  file/  test/  external/  event/  component/
  page/  job/  flow/  state/  diagram/  agent/  role/  plan/
```

- The plan root is a folder named `constellation/`, normally at the repo root. Tooling
  finds it by walking up from the working directory (like `.git`).
- Each card lives in the folder matching its type (see table below). Folder placement is
  a **convention**: the handle prefix is authoritative for type; a card in the wrong
  folder lints as a warning, not an error.
- `plan.md` at the plan root is the one special file: it is the card `PLAN-PROJECT`
  (type PLAN). Additional PLAN cards (e.g. `PLAN-FRONTEND`) live in `plan/`.

## Files and handles

**The filename is the handle.** `api/API-TICKETS.md` defines the card `API-TICKETS`.
There is no `handle:` or `type:` field in frontmatter — the path already says it, and one
source of truth means they can never disagree.

Handle grammar:

```
^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$     (3–135 characters)
```

Uppercase letters, digits, and dashes. The prefix (everything before the first dash)
determines the type and MUST be one of the 17 canonical prefixes. v1 alias prefixes
(`TYPE-`, `COMP-`, `RULE-`) are not valid in v2.

| Type      | Prefix       | Folder       | What it is                                  |
|-----------|--------------|--------------|---------------------------------------------|
| API       | `API-`       | `api/`       | HTTP/RPC endpoints                          |
| DB        | `DB-`        | `db/`        | Database tables / collections               |
| DATATYPE  | `DATATYPE-`  | `datatype/`  | Data type schemas (interfaces, Zod, etc.)   |
| ROLE      | `ROLE-`      | `role/`      | User roles / permission groups              |
| DOC       | `DOC-`       | `doc/`       | Documentation cards                         |
| FILE      | `FILE-`      | `file/`      | Source file references                      |
| TEST      | `TEST-`      | `test/`      | Test specs                                  |
| EXTERNAL  | `EXTERNAL-`  | `external/`  | External services / integrations            |
| EVENT     | `EVENT-`     | `event/`     | Domain events / signals                     |
| COMPONENT | `COMPONENT-` | `component/` | Reusable UI components                      |
| PAGE      | `PAGE-`      | `page/`      | Frontend routes / screens                   |
| JOB       | `JOB-`       | `job/`       | Background / scheduled / queued work        |
| FLOW      | `FLOW-`      | `flow/`      | Multi-step sequenced processes              |
| STATE     | `STATE-`     | `state/`     | State machines                              |
| DIAGRAM   | `DIAGRAM-`   | `diagram/`   | Architecture diagrams                       |
| AGENT     | `AGENT-`     | `agent/`     | AI agent instructions / policies            |
| PLAN      | `PLAN-`      | `plan/`      | Plan documents (`plan.md` = `PLAN-PROJECT`) |

## Card anatomy

```markdown
---
name: List & create tickets
status: built
path: /api/v1/tickets
methods:
  GET:
    query_params:
      - { name: status, type: string }
    response_schema: DATATYPE-TICKET
  POST:
    request_schema: DATATYPE-CREATE-TICKET-INPUT
    response_schema: DATATYPE-TICKET
connections:
  - DB-TICKETS
---

# Tickets API

Returns tickets for the active inbox. POST validates the requester exists
before inserting — see [[FLOW-CREATE-TICKET]] for the full sequence.
```

### Frontmatter

YAML frontmatter is optional. Four keys are **reserved** (defined in
`schemas/card.json`); every other key is a type-specific field (defined in
`schemas/<type>.json`):

| Key           | Type     | Meaning                                                      |
|---------------|----------|--------------------------------------------------------------|
| `name`        | string   | Display name (the handle is the identity; this is the label) |
| `kind`        | string   | Subtype discriminator, lowercase slug (`sql-table`, `e2e`, `decision`) |
| `status`      | enum     | Lifecycle: `planned` \| `building` \| `built` \| `verified`  |
| `connections` | string[] | Plain list of handles this card is connected to              |

Type-specific fields sit at the top level of frontmatter (not nested under a `data` key).
Schemas are permissive: almost nothing is required, known fields are typed, unknown
fields are allowed (lint warns so typos get caught).

### Body

The body is markdown — the card's narrative. Two constructs are graph-aware:

- **Wiki-links**: `[[API-TICKETS]]` connects this card to `API-TICKETS`. Use them freely
  in prose; they are the cheapest way to wire the graph.
- **Mermaid blocks**: inside ` ```mermaid ` fences, any node identifier shaped like a
  handle counts as a connection (see Diagrams below).

## Graph rules

The indexer derives the connection set from four sources, in all cards:

1. The `connections:` list in frontmatter.
2. Handle-shaped string values anywhere else in frontmatter (so
   `response_schema: DATATYPE-TICKET` connects automatically — no need to repeat it in
   `connections`).
3. `[[HANDLE]]` wiki-links in the body.
4. Handle-shaped identifiers inside ` ```mermaid ` blocks in the body.

Connections are **undirected** and deduped by pair: declare a connection on whichever
card you are editing; both cards see it when queried. Self-references are ignored. The reverse
view ("what points at X?") is the indexer's job — it is never written into files.

## Diagrams and flows

Three tiers, cheapest first:

1. **Derived subgraphs** (default for "what does this area look like"): the viewer/MCP
   render any card's neighborhood from the real connection graph on demand. Never stored,
   never stale.
2. **Authored Mermaid** (default for conceptual diagrams): a DIAGRAM card whose body is a
   ` ```mermaid ` block. Use handles as Mermaid node IDs so the diagram joins the graph.
   Sequence diagrams (`sequenceDiagram`) and state diagrams (`stateDiagram-v2`) work the
   same way in FLOW and STATE cards.
3. **Pinned layouts** (escape hatch for curated diagrams): structured `nodes` / `edges` /
   `phases` in DIAGRAM frontmatter with explicit positions — see `schemas/diagram.json`. Use
   only when layout carries meaning; positions make noisy diffs.

**FLOW cards are linear.** Steps are a numbered markdown list in the body, with nested
list items for error/edge cases. If a flow needs real branching, it is either a Mermaid
flowchart or actually a STATE card.

```markdown
1. [[PAGE-INBOX]] submits the new ticket form
2. [[API-CREATE-TICKET]] validates the requester
   - if the requester is unknown → 422, form shows inline error
3. Ticket row inserted into [[DB-TICKETS]]
4. [[EVENT-TICKET-CREATED]] fires → [[JOB-AUTO-ASSIGN]]
```

## Lint policy

**Errors** (break the graph; non-zero exit, CI should block):

| Code | Rule |
|------|------|
| E001 | Filename is not a valid handle |
| E002 | Handle prefix is not one of the 17 canonical prefixes |
| E003 | Duplicate handle (two files resolve to the same handle) |
| E004 | `connections` entry is not a handle-shaped string |
| E005 | `connections` or frontmatter-field target resolves to no card |
| E006 | Frontmatter is not valid YAML |

**Warnings** (style/quality; reported, exit 0):

| Code | Rule |
|------|------|
| W001 | Card is not in the folder matching its type |
| W002 | Frontmatter violates the type's JSON Schema |
| W003 | Unknown frontmatter field (not reserved, not in the type schema) |
| W004 | Body `[[link]]` or Mermaid reference resolves to no card |

The split between E005 and W004 is deliberate: structured references (frontmatter) are
contracts and must resolve; prose references may legitimately point at cards that are
planned but not yet written.

## Change tracking and sync

- **What changed**: `git diff <ref> -- constellation/` . Plan changes ride branches and
  PRs like any other change; reviewing a plan PR is the human approval gate before an
  AI syncs code to it.
- **Sync marker**: a reconciling agent records the last plan commit it synced code
  against (e.g. a `constellation-synced` tag or a SHA noted in `plan.md`). "Dirty" =
  everything in `git diff <synced>..HEAD -- constellation/`. No per-card stamping.
- **Lifecycle**: `status` tracks where a card is in its life (`planned` → `building` →
  `built` → `verified`), orthogonal to git history. An agent that verifies a card
  against the actual code sets `status: verified`.

## What is deliberately not in the format

- No IDs other than handles. No UUIDs/ULIDs.
- No connection kinds, directions, or metadata. If a relationship needs explanation,
  explain it in prose in the body — structure is for navigation, prose is for meaning.
- No revision/branch/diff machinery. Git does that.
- No required fields beyond the filename (single exception: `FILE` cards require `path`,
  because a file reference without a path refers to nothing).
