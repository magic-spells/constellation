---
name: Atlas — the plan as a city
kind: page
status: verified
route: /constellation/atlas
section: viewer
order: 41
connections:
  - FILE-ATLAS-SCENE
  - FILE-SERVE
  - FEATURE-ARCHITECTURE-ATLAS
  - DECISION-ATLAS-TWO-ENGINES
  - DECISION-ATLAS-CONFIG-FILE
  - PAGE-VIEWER-CONSTELLATION
verified_at: '2026-08-18T17:56:53.411Z'
verified_sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
---

The isometric city: **what shape is this system, and where does data go**. The
second reading of the graph [[PAGE-VIEWER-CONSTELLATION]] renders as nodes.

Districts are FEATURE cards, buildings are every other card, roads are FLOW
cards. Same data, macro reading.

## The URL is the state

- `/constellation/graph` · `/constellation/atlas` — the two readings, as tabs
- `/constellation/atlas/HANDLE` — inside one card's neighbourhood

`/constellation` guard-redirects to the graph, so every older link still works.
Both routes are full-bleed: the canvas owns the whole box and every control —
tabs, lens picker, engine switch, trace panel — floats over it.

## Two engines, one scene

`atlas-scene.js` computes the city; the isometric canvas painter and the three.js
painter both consume it. See [[DECISION-ATLAS-TWO-ENGINES]] for why that split,
and why three is vendored rather than bundled.

## Interaction

Hover reads a building (name, what is inside it, and whether it has drifted).
Click goes inside — except a FLOW, where clicking **walks** it: the card's
numbered steps become a guided tour with the camera flying to each stop.

Dragging always pans, including on a building. Moving one by hand implies an
authority this view does not have, since placement is computed from the graph;
an authored position is `atlas.json` config ([[DECISION-ATLAS-CONFIG-FILE]]),
not a gesture.

Going inside a card whose neighbours are all FEATUREs would leave one building
alone on an empty plate, since features are districts rather than buildings — so
a thin first hop expands to a second.

## Lenses

Colour and height are independent channels. `status` is the default and keeps the
city flat, because arriving on a level map reads as "here is the shape of the
plan" rather than "here is a chart". `degree`, `recency` and `size` raise
buildings; `drift` raises **and** scaffolds them.

Drift is the one that justifies the feature: it is computed live from each claim
card's `verified_sha` against its bound files, so the city cannot quietly go
stale — divergence is exactly what it lights up.

## Picking

An offscreen colour-ID buffer, not geometry math: every building is redrawn in a
unique flat colour and picking is one pixel read. Exact at any zoom and for any
silhouette, and it cannot drift from the visible drawing because it runs off the
same shape code. Rebuilt only when the camera or the scene changes.
