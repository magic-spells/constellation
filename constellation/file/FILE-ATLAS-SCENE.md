---
name: atlas-scene.js — the city layout
kind: file
status: built
path: viewer/app/lib/atlas-scene.js
language: javascript
summary: 'Pure scene-graph builder: districts, packing, footprints, floors, orthogonal routing.'
section: viewer
order: 42
connections:
  - PAGE-VIEWER-ATLAS
---

The whole atlas layout, and the contract both renderers consume. Pure — no DOM,
no canvas, no WebGL, no Puzzle — so it is unit-testable in plain Node and the two
painters cannot show different cities.

## Determinism is a hard requirement

The entire value of a map is that the DB is where the DB was last time. So: no
`Math.random`, no force simulation, no modularity clustering, no iteration over
unsorted keys. Every ordering breaks ties on the handle, which is unique. A test
asserts the same plan produces a byte-identical scene.

## What it decides

- **Districts** from FEATURE connections. Not a partition — a card may be claimed
  by several features or none — so a contested card joins the *smallest* claimer
  (a focused feature has the better claim) and an unclaimed one falls back to a
  district for its type.
- **Floors** — the parts inside a building — from bound FILE paths, then
  `code_refs` symbols, then `##` headings. Sections apply only when nothing binds,
  or a tower would stop meaning "this much code".
- **Roads** from FLOW steps, routed orthogonally through the gutters *between*
  district plates. Routed straight between building centres first, which drew
  every road underneath the buildings and made them invisible.

## Units

One cell is 80 world units, so a footprint is the same order as a graph node's
box. That is what lets both canvas views share one camera and one set of zoom
limits — a smaller cell needs a scale the shared camera would clamp away.
