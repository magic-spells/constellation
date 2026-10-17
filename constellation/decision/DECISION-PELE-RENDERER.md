---
name: Pele draws the mermaid fences
kind: decision
status: building
section: decisions
order: 31
connections:
  - PAGE-VIEWER-CARD
  - DOC-DIAGRAMS
  - DECISION-ATLAS-TWO-ENGINES
---


The viewer renders ```mermaid fences with **Pele** (Obsidian's Mermaid-syntax renderer,
`pele` on npm, MIT) instead of the `mermaid` package. Shipped in 1.2.0.

## What does not change

The card files. A fence is still ```mermaid with Mermaid syntax inside, so GitHub,
Obsidian and any markdown reader keep rendering plans exactly as before. Pele is a
renderer for that syntax, not a dialect, and it rejects the same inputs Mermaid does
(the comparison harness showed both parsers failing the same two fixtures). The
`.mermaid-block` placeholder, the `renderMermaidBlocks` export and the print page's
"wait for diagrams" logic all stay.

## Why

Measured with `scripts/compare-renderers/` on every fence in this plan, the examples
and the skill plus 15 fixtures (flowchart, state, sequence, class, ER, gantt, gitGraph,
mindmap, pie, xychart, quadrant, timeline):

- Every diagram parsed and rendered on both. Layout matched; Pele's subgraphs, edge
  labels, gantt, class and ER output were cleaner and larger.
- Bytes fetched for a flowchart + state page: 907 KB → 167 KB. `viewer/dist`:
  11.8 MB / 310 files → 2.4 MB / 142 files, because mermaid's 291 chunked ESM files
  (11 MB) are replaced by pele's ~1 MB tree.
- Render time per plan diagram: 20–80 ms → 1–12 ms, synchronous.
- Zero runtime dependencies (mermaid pulled d3, dagre, KaTeX).

## How it is wired

Same trick as three and the old mermaid: `scripts/copy-pele.mjs` vendors
`node_modules/pele/dist/esm` into `viewer/app/public/vendor/pele/`, and
`markdown.js` imports `/vendor/pele/lazy.js` through a variable URL so the single
`app.js` does not inline it. Colours are `--pele-*` tokens set on `.mermaid-block` in
`styles.css`, so a scheme or theme switch restyles a drawn SVG without re-rendering.
Handle nodes are tinted by type from `g.pele-node[data-id]` with `color-mix` on the
`--t-<TYPE>` tokens — by node **id** now, where mermaid's pass read label text.

## Accepted differences

- `links: false, images: false`: `click X href` in a fence is inert. No plan uses it.
- Edge labels sit in a gap in the line instead of on a painted box.
- `%%{init}%%` theme directives inside a fence are ignored; the theme is ours.
- Mermaid add-on types (zenuml) are not supported. Pele covers every core type and
  more (pie, xychart, radar, sankey, treemap).
- The authoring skill must keep recommending the common subset: Pele targets Mermaid
  12.1 syntax, GitHub runs an older Mermaid, and a Pele-only construct would render
  here but break there.

## Rejected: keep mermaid and trim its chunks

The 11 MB is mostly per-layout-engine duplicates of each diagram type; pruning them
would have meant maintaining a fork of mermaid's chunk map for a 2–3× gain, versus
10× for free.
