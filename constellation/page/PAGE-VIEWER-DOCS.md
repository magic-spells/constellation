---
name: Viewer — documentation
kind: route
status: built
code_refs:
  - viewer/app/views/DocsPage.pzl
  - viewer/app/components/DocsToc.pzl
  - viewer/app/lib/docs.js
  - src/core/docs.ts
connections:
  - FILE-SERVE
  - DOC-FILE-FORMAT
  - PAGE-VIEWER-CARD
---


Every sectioned card compiled into ONE ordered document — the answer to "what is
this project", read top to bottom, and the thing you print. `/docs` for the whole
document, `/docs/:section` for one section.

Ordering comes from the files: a card's `section:` slug and `order:`, with the
sections themselves ordered by `doc_sections:` on `PLAN-PROJECT` (see
[[DOC-FILE-FORMAT]]). `src/core/docs.ts` is the single compiler — `compileDocs`
returns the tree, and heading-shift/link-resolution sit on top as render
concerns, so the tree stays pure data for any future consumer (a CLI export, an
MCP `get_docs`).

## Heading levels are assigned, never trusted

Document title → **H1**, section name → **H2**, card `name:` → **H3**, and the
card's own headings shift down two beneath it. Two rules keep that honest: fenced
blocks are skipped **whole** (a `# comment` in a bash fence is not a heading),
and a body-opening H1 that restates the card's `name:` is dropped rather than
shifted — many cards are written that way and would otherwise render their title
twice.

`[[HANDLE]]` resolves by whether the target is on the page: in-document links
become anchors, everything else links to the card's own route. On a soloed
section, a card in another section is "out" — it links to its card page, not
across to the other section's document.

## Layout: a gutter rail, not a split pane

`/docs` opts OUT of [[PAGE-VIEWER-CARD]]'s split — the contents float in the left
gutter as sticky marginalia beside a **centred 48rem column**. A split pane would
push the document to one side, and the document is the thing that has to be
centred. 48rem rather than the 70rem used elsewhere for prose: at document type
size 70rem is far past a readable measure, and the narrower column widens the
gutter so the rail survives at more window sizes.

Gotchas worth keeping, both found only by resizing a real browser:

- A `display: none` grid item is **removed from the grid**, so hiding the rail
  slid the column into track 1 — a sideways jump on resize. Pin `grid-column`.
- `minmax(0, cap)` has a fixed 0 minimum, so `1fr` gutters take all free space and
  the column collapses. Use `min(cap, 100%)`.

The rail/compact switch is a **container query** on `.docs`, not a viewport media
query, so collapsing the app sidebar brings the rail back without the window
changing size. Below the threshold the contents become a `<select>` inside the
column, and the column's width and centre do not move either way.

## Print

Printing is the PDF export — no separate pipeline. Chrome is dropped, `@page`
margins applied, a page break before every section, and a cover page (project
name, package version, date). It applies on **every** route, not just here: a
chrome-free print of a card page beats a cropped screenshot.

Print redeclares the colour tokens rather than trusting `color-scheme: light`,
because observatory carries the same dark value in both halves of every
`light-dark()` pair — without the override it prints a black page.

Known rough edge: mermaid SVG fills are baked at render time from computed
tokens and don't re-render on the print media change, so diagrams print in their
screen colours. Legible, but not paper-tuned.
