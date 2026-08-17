---
name: File format
kind: spec
status: built
connections:
  - FILE-INDEXER
  - FILE-EXTRACT
  - DOC-CARD-TYPES
  - DOC-LINT-CODES
  - DOC-CONNECTED-REPOS
section: format
order: 10
---

# File format

Constellation stores a project's architecture plan as markdown files under a `constellation/`
folder. Each file is one **card** — one typed piece of the plan, linked to others by
**connections**. ("Node" is reserved for diagram elements inside DIAGRAM cards.) This is the
normative format; the JSON Schemas in `schemas/` define per-type frontmatter and
[[FILE-INDEXER]] is the reference implementation.

## Files are handles

The filename IS the handle: `api/API-TICKETS.md` defines the card `API-TICKETS`. There is no
`handle:` or `type:` field — the path already says it. Handle grammar:
`^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$` (3–135 chars; uppercase, digits, dashes). The prefix
before the first dash is the type and must be one of the 21 canonical prefixes (see
[[DOC-CARD-TYPES]]). `plan.md` at the root is the one special file — the card `PLAN-PROJECT`.

## Frontmatter


YAML frontmatter is optional; a card with none is valid. Four keys are **reserved**
(`schemas/card.json`): `name`, `kind` (lowercase-slug subtype), `status`
(`planned`→`building`→`built`→`verified`), `connections` (list of handles). Beyond those,
card.json defines **cross-type metadata** valid on any card, in two flavours that behave
differently:

- **Tool-managed provenance** — `code_refs` (code binding, `path` or `path:symbol`),
  `verified_sha` / `verified_at` (the drift baseline — see [[DOC-CHANGE-TRACKING]]), and
  `notes` (append-only typed memory `{kind,text,sha?}`). The tools write these; don't
  hand-author them.
- **Authored placement** — `section` (a lowercase slug) and `order` (an integer) put a card
  into the compiled document at `/docs`. Sections are themselves ordered by `doc_sections:`
  on `PLAN-PROJECT` (`{id, name, summary?}`); a slug used on a card but never registered
  there falls to the end rather than erroring. A card with no `section` is simply not in
  the document. See [[PAGE-VIEWER-DOCS]].

Everything else is a type-specific field. Schemas are permissive: almost nothing is
required; unknown fields warn (W003) rather than fail.

## The graph (frontmatter only)

[[FILE-INDEXER]] derives the connection set, in all cards, from **frontmatter alone**: (1) the
`connections:` list; (2) any handle-shaped string elsewhere in frontmatter (so
`response_schema: DATATYPE-TICKET` connects automatically). Connections are **undirected** and
deduped by pair — declare on whichever card you're editing; the reverse view is the indexer's
job, never written to disk.

**A prose mention is a link, not a connection.** `[[HANDLE]]` wiki-links in the body and
handle-shaped IDs inside mermaid blocks are hyperlinks: the viewer renders them clickable and
lint checks that they resolve (W004), but they are never graph edges. Every relationship the
graph should know belongs in `connections:`. All four reference kinds are extracted in
[[FILE-EXTRACT]]; only the first two build edges.

## Body conventions

Markdown narrative. DATATYPE: the type as a fenced code block. FLOW: a numbered list of steps
(linear — branch via mermaid or a STATE card). STATE: a mermaid `stateDiagram-v2`. DIAGRAM: a
mermaid flowchart with handles as node IDs. See [[DOC-DIAGRAMS]]. Lint codes: [[DOC-LINT-CODES]].

## Deliberately not in the format

No IDs but handles. No cross-repo card references (siblings link at the project level — see
[[DOC-CONNECTED-REPOS]]). No connection kinds / directions / metadata — put nuance in prose. No
revision/diff machinery — git does that. No required fields beyond the filename, except FILE
cards require `path`.
