---
name: Documentation sections and export
status: built
change: feature
connections:
  - DOC-CARD-TYPES
  - DOC-FILE-FORMAT
  - PAGE-VIEWER-HOME
  - PAGE-VIEWER-DOCS
  - FILE-SERVE
  - FILE-CLI
  - FILE-MCP-SERVER
release: RELEASE-V0-6-0
notes:
  - kind: state
    text: >-
      Built and merged into release/0.6.0. Shipped: schema keys, src/core/docs.ts, GET /api/docs,
      /docs + /docs/:section, print stylesheet, golden plan sectioned (3 sections, 10 cards).
      Deferred by design: `constellation docs --out`, the `get_docs` MCP tool, Paged.js page
      numbers, handle-valued `section:`. Agent guidance (skill/SKILL.md, skill/methodology.md, MCP
      INSTRUCTIONS) does not yet mention `section:`/`order:` — describe_type self-serves them from
      the schemas, so it is a gap rather than a break.
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


A **Documentation** row in the top rail group next to Tasks — the same altitude,
because it answers a peer question ("what is this project", vs "what is in
flight"). Full detail of what shipped is on [[PAGE-VIEWER-DOCS]].

The layout went through one correction worth recording. The first plan put the
table of contents in `AppShell`'s existing `SplitPanel` left slot, to reuse the
drag-to-resize. Wrong: a fixed left pane pushes the document to the right, and
the document is the one thing that has to be centred. `/docs` opts out of the
split entirely — centred column, contents floating in the left gutter as sticky
marginalia with no panel chrome.

The column is **48rem, not the 70rem** first specified. At document type size
70rem is far past a readable measure; the narrower column also widens the gutter,
so the rail survives at more window sizes.

- `/docs` — the whole document, one scroll. `/docs/:section` — one section.
- Contents are **two levels**, section → card, with scroll-spy.
- Per-card anchors. The app is hash-routed, so the deep link is
  `#/docs#DOC-FILE-FORMAT` — two fragments, not the `/docs#HANDLE` first specced.
- Each card heading links back to its own card page; the compiled view is
  read-only.

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


Settled while building:

- **Slug**, with the display name on `doc_sections` (`{id, name, summary?}`).
- **One level.** `section: guides/authoring` stays reserved for a third level.
- **`order:` is sparse by convention**, unset sorts last, ties break on name then
  handle. No lint code for duplicates.
- **A registered section with no cards is dropped** — a heading over nothing helps
  nobody, least of all on paper.
- **Grouping accepts any non-empty string**, not only a valid slug: a typo'd
  `section: Getting Started` shows up in the document where you can see and fix
  it, rather than silently vanishing. W002 is what says it isn't a slug.
- **Per-plan.** `/docs` does not span connected repos.

Still open:

- **`doc_title` on PLAN-PROJECT** — not shipped; the H1 is the project name.
- **The card.json tension is real and unresolved.** `section`/`order` are
  *authored*, while every other cross-type key there is tool-managed provenance.
  The schema descriptions distinguish them and so does [[DOC-FILE-FORMAT]], but
  the invariant in `CLAUDE.md` still calls card.json tool-managed wholesale.

## Acceptance

- `examples/constellation/` gains sections and still lints clean.
- `/docs` renders every sectioned card in author-intended order with correct
  heading levels, and no heading inside a fenced block is shifted.
- Print preview is a readable document: cover, TOC, page break per section.
- `constellation docs --out` and `get_docs` return the same ordering as `/docs`.
