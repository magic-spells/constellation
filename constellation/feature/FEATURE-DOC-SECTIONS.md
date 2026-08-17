---
name: Documentation sections and export
status: planned
change: feature
connections:
  - DOC-CARD-TYPES
  - DOC-FILE-FORMAT
  - PAGE-VIEWER-HOME
  - FILE-SERVE
  - FILE-CLI
  - FILE-MCP-SERVER
release: RELEASE-V0-6-0
---

DOC cards are a flat pile: one folder, alphabetical, no order and no grouping.
That is fine for reference lookup and useless as *documentation* — nobody reads
`doc/` top to bottom and comes away with a coherent manual. People reach for
Google Docs and H1/H2/H3 because it gives them one ordered document with named
sections. This is Constellation's answer to that: keep one file per card, and
**derive** the document.

The payoff is a real deliverable — a project's complete documentation, compiled
from the same cards agents read and write, viewable as one page and printable to
PDF. Docs stop being a second artifact that rots next to the plan; they *are*
the plan, ordered.

## How grouping works

Membership is self-declared on the card; ordering of the sections themselves is
authored once on `PLAN-PROJECT`.

- Card gains `section:` (the section it belongs to) and `order:` (a number,
  position within the section; ties break on `name`, then handle).
- `PLAN-PROJECT` gains `doc_sections:` — an **ordered** list of section entries
  (`{ name, summary? }`). Authored ordering, not derived state, exactly like
  `connected_repos`.
- A section that appears on cards but not in `doc_sections` is appended at the
  end alphabetically. Degrades quietly; no error for forgetting to register it.

These two keys belong in `schemas/card.json`, not `schemas/doc.json` — a
documentation set often wants a DECISION or a FLOW inline, and card.json is the
home for cross-type metadata (see [[DOC-FILE-FORMAT]]). Anything with a
`section:` joins the document; anything without stays out of it. Note the
tension worth resolving before building: card.json's other cross-type keys are
tool-managed provenance, and these two are hand/agent authored.

## Compiling the document

Heading levels are assigned, never trusted:

- **H1** = the document title (project name, or a `doc_title` on PLAN-PROJECT).
- **H2** = section name.
- **H3** = card `name:`.
- The card's own body headings shift down by two, so a card's `##` renders `####`.

Two rules make that safe. Fenced blocks are skipped **whole** — a `# comment`
inside a bash fence is not a heading (the same fence-skipping
`BoardPage.summaryOf` already does). And if a body opens with an H1 that
restates `name:`, that line is dropped rather than shifted — several cards in
this plan are written that way.

`[[HANDLE]]` links resolve by whether the target is *in* the compiled document:
in → an in-page anchor; out → a link to that card's viewer route. In print mode
an out-link degrades to the card's name in plain text, since a PDF reader can't
follow it.

## The viewer


A **Documentation** row in the top rail group next to Tasks — the same
altitude, because it answers a peer question ("what is this project", vs "what
is in flight").

Layout: table of contents on the left, one long document in the centre. That
needs no new layout — `AppShell` already runs a `SplitPanel` with `CardList` in
`slot="first"`, so the TOC takes that slot and inherits the drag-to-resize.

- `/docs` — every sectioned card compiled into one scrolling document, centre
  column capped near 70rem so it reads like a page and not a wall.
- The TOC is **two levels**, section → card. A ten-card section needs its cards
  clickable, not just its heading. Scroll-spy lights the current one.
- Per-card anchors, so `/docs#DOC-FILE-FORMAT` is a real deep link.
- `/docs/:section` — one section on its own.
- Each card heading carries a quiet link back to its own card page for editing;
  the compiled view stays read-only.

Sticky TOC and printed TOC are the same tree, different renders: the printed one
drops scroll-spy and eventually gains page numbers.

See [[PAGE-VIEWER-HOME]] for where the rail rows live.

## Export

Phase 1 is browser print-to-PDF against a real print stylesheet, served by
[[FILE-SERVE]]: no app chrome, `@page` margins, a page break before every H2, a
cover page (project name, package version, date, git sha), widow/orphan control,
and code blocks that don't split badly. A generated TOC without page numbers.

Page numbers *in* the TOC need `target-counter`, which browser print doesn't
support — that is a phase-2 item and costs a vendored Paged.js. Do not let it
block phase 1.

Also cheap once the compiler exists, and worth having:

- `constellation docs --out DOCS.md` on [[FILE-CLI]] — the whole document as one
  markdown file, for a static site, a README, or a paste into anything.
- A `get_docs` tool on [[FILE-MCP-SERVER]] — an agent reads the project's entire
  documentation, in author-intended order, in one call. This may be the most
  valuable half of the feature and it is nearly free.

## Where the code goes

`src/core/docs.ts` — `compileDocs(plan)` returns an ordered tree
(`[{ section, summary, cards: [{ handle, name, body }] }]`). One compiler,
three consumers: the serve API (`GET /api/docs`), the CLI export, and the MCP
tool. Heading shift and link resolution are render-time concerns layered on top,
not baked into the tree.

## Considered and rejected

- **A SECTION card type.** Costs a 22nd type across four places
  ([[DOC-CARD-TYPES]]), and a section is not a thing with connections — it is an
  ordering. Wrong primitive.
- **An index DOC card enumerating its children.** Directly against the standing
  invariant that cards never enumerate other cards; it also rots the moment a
  card is added.
- **Deriving sections purely from connections** (docs connected to a FEATURE
  group under it). Attractive — zero new fields, uses the graph — but a doc card
  is usually connected to several things, so grouping is ambiguous, and ordering
  still needs an authored number.

That last one is worth keeping as a phase-2 idea in a hybrid form: allow
`section:` to hold either a free string **or** a handle. Handle-shaped means a
structured ref (E005-checked, and it connects the two cards), and the section's
title is that card's `name`. "The docs that document this feature" becomes a
section with no duplicated title to keep in sync.

## Open questions

- **Slug vs display name.** A free-string `section:` means renaming a section is
  an edit to every card in it. A slug plus a display name on `doc_sections`
  fixes that at the cost of one indirection. Leaning slug.
- **Nesting.** One level to start. Reserve `section: guides/authoring` as the
  path syntax if a third level is ever needed, so the field doesn't have to
  change shape later.
- **`order:` collisions and gaps.** Sparse numbering (10, 20, 30) by convention;
  no lint code for duplicates, just a stable tiebreak.
- **Is `/docs` per-plan only, or does it span connected repos?** Per-plan first.

## Acceptance

- `examples/constellation/` gains sections and still lints clean.
- `/docs` renders every sectioned card in author-intended order with correct
  heading levels, and no heading inside a fenced block is shifted.
- Print preview is a readable document: cover, TOC, page break per section.
- `constellation docs --out` and `get_docs` return the same ordering as `/docs`.
