---
name: File format
kind: spec
status: built
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
before the first dash is the type and must be one of the 17 canonical prefixes (see
[[DOC-CARD-TYPES]]). `plan.md` at the root is the one special file — the card `PLAN-PROJECT`.

## Frontmatter

YAML frontmatter is optional; a card with none is valid. Four keys are **reserved**
(`schemas/card.json`): `name`, `kind` (lowercase-slug subtype), `status`
(`planned`→`building`→`built`→`verified`), `connections` (list of handles). Beyond those,
card.json also defines **cross-type metadata** valid on any card, tool-managed rather than
hand-authored: `code_refs` (code binding, `path` or `path:symbol`), `verified_sha` /
`verified_at` (the drift baseline — see [[DOC-CHANGE-TRACKING]]), and `notes` (append-only
typed memory `{kind,text,sha?}`). Everything else is a type-specific field. Schemas are
permissive: almost nothing is required; unknown fields warn (W003) rather than fail.

## The graph (four connection sources)

[[FILE-INDEXER]] derives the connection set, in all cards, from: (1) the `connections:` list;
(2) any handle-shaped string elsewhere in frontmatter (so `response_schema: DATATYPE-TICKET`
connects automatically); (3) `[[HANDLE]]` wiki-links in the body; (4) handle-shaped IDs inside
mermaid blocks. Connections are **undirected** and deduped by pair — declare on whichever card
you're editing; the reverse view is the indexer's job, never written to disk. Extraction lives
in [[FILE-EXTRACT]].

## Body conventions

Markdown narrative. DATATYPE: the type as a fenced code block. FLOW: a numbered list of steps
(linear — branch via mermaid or a STATE card). STATE: a mermaid `stateDiagram-v2`. DIAGRAM: a
mermaid flowchart with handles as node IDs. See [[DOC-DIAGRAMS]]. Lint codes: [[DOC-LINT-CODES]].

## Deliberately not in the format

No IDs but handles. No cross-repo card references (siblings link at the project level — see
[[DOC-CONNECTED-REPOS]]). No connection kinds / directions / metadata — put nuance in prose. No
revision/diff machinery — git does that. No required fields beyond the filename, except FILE
cards require `path`.
