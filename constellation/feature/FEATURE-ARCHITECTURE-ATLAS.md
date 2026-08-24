---
name: Architecture atlas — the plan as an isometric city
status: verified
change: feature
connections:
  - DOC-DIAGRAMS
  - FILE-SERVE
  - PAGE-VIEWER-HOME
  - PAGE-VIEWER-ATLAS
  - PAGE-VIEWER-CONSTELLATION
  - FILE-ATLAS-SCENE
  - DECISION-ATLAS-TWO-ENGINES
  - DECISION-ATLAS-CONFIG-FILE
release: RELEASE-V0-6-0
branch: feat/architecture-atlas
notes:
  - kind: deviation
    text: >-
      Both aesthetics shipped together, not paper-first-then-3D as this card proposed. A pure
      scene-graph module made the second painter additive rather than a rewrite, so phasing bought
      nothing. See DECISION-ATLAS-TWO-ENGINES.
  - kind: deviation
    text: >-
      `constellation atlas --png` was not built; in-app PNG download was. A CLI flag needs a
      headless browser, which is a disproportionate dependency for a still image.
  - kind: verified
    text: >-
      Driven in a browser at 0.6.0: both engines, all five lenses, flow trace, drill-down, hover
      readout, and the atlas.json config path. 645 tests green.
    sha: 2790152d9503b921ee03c26f14a5f9e31b0b70f1
verified_at: '2026-08-24T21:11:20.573Z'
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
---

The constellation canvas at `#/constellation` answers *what connects to what*.
It does not answer *what is this system shaped like* or *where does data go*.
An **atlas** does: the plan rendered as a city seen from above — buildings are
cards, districts are groupings, roads are connections, and dots travel the roads
to show flow. Same graph, a macro reading of it.

## Why this belongs here and not in a one-off artifact

The "codebase atlas" prompts going around scan a repo and *infer* structure into
a static artifact — impressive once, stale immediately, and only as good as the
inference. Constellation already holds the thing those prompts are trying to
reconstruct: a typed, connected, human-curated graph, with code binding (FILE
cards' `path:`, `code_refs`) and FLOW cards carrying **ordered steps**. The atlas
is a render of data we already have, served by [[FILE-SERVE]], which watches the
files — so it is live, not a snapshot.

The inverse is also a feature: if a card isn't in the plan it isn't in the city.
A repo with 400 files and 21 FILE cards has a visibly small city, and that is an
honest coverage signal.

## Shape vocabulary

One building silhouette per card type, defined once next to the existing per-type
colour/icon map in `viewer/app/lib/types.js`:

- **DB** — round/cylindrical tower (the shape everyone already reads as a store).
- **API** — a slab with a portal facing the street; endpoints are doors.
- **PAGE / COMPONENT** — residential blocks, small and repeated.
- **JOB** — a plant with a rotating element; it runs on its own.
- **EVENT** — an antenna or beacon, broadcasting.
- **EXTERNAL** — off-map, across a dashed boundary. Outside the city limits.
- **FILE** — the ground plates buildings sit on, not buildings themselves.
- **DOC / DECISION** — monuments and signposts: low, wide, inscribed.
- **TEST** — scaffolding wrapped around whatever it covers.
- **FLOW** — the roads.
- **AGENT** — a figure moving through it.

## Layout

District candidates, in preference order:

1. **By FEATURE** — cards connected to a FEATURE card form a district. Matches
   how people actually think about a system ("the auth district"), and the graph
   already encodes it.
2. **By type** — fallback for cards no feature claims. Honest, if dull.
3. **By graph community** (modularity clustering) — automatic, but unstable
   frame-to-frame, which is fatal for spatial memory.
4. **By code path**, for cards bound to files — mirrors the repo tree.

Layout is **settled once and tweened**, never live physics, and cached against a
hash of the graph so the city does not rearrange between reloads. Cache in the
browser, never in the cards — nothing derived is stored.

## Lenses

Colour and height are two independent channels; make the second a selector, the
way the reference screenshots do (`lens: TODO DEBT`):

- **status** — the default colouring.
- **degree** — height by connection count; hubs are towers.
- **drift** — stale claims render scaffolded or crumbling. This is the killer
  lens: drift becomes a thing you *see* from across the map.
- **recency** — lit by how recently the card or its bound code changed.
- **code size** — height by LOC of bound files.

## Flow and trace

FLOW cards have ordered steps, so a flow is a route: dots travel it, and a
**trace mode** steps through one step at a time with a caption panel and
back/next/pace controls (the guided-tour pattern in the reference images). This
is the strongest fit of the whole idea, because the step data already exists —
see [[DOC-DIAGRAMS]] for how flows are modelled today.

## Drill-down

Click a building, the camera flies in; inside is that card's neighbourhood as its
own small city. Keyboard model from the drafting-paper reference: `→ go inside ·
← come back out · drag to pan · scroll to zoom · hover to read`.

URL-driven, like everything else in this viewer: `/constellation/atlas` and
`/constellation/atlas/HANDLE`, so deep links and the Back button work. That also
suggests the destination shape — **the graph and the atlas are two tabs of one
destination**, exactly the pattern Tasks established, rather than a fifth rail
row.

## Two aesthetics, in order

1. **Hatched drafting-paper isometric.** Flat 2.5D line art on a warm paper
   ground, hatched faces, no lighting. Canvas 2D with an isometric projection —
   the same technology as the existing constellation renderer, no new dependency
   — and it prints, which ties it to the PDF export in
   [[FEATURE-DOC-SECTIONS]]. Build this first.
2. **Lit 3D city.** three.js, real geometry, dusk lighting, ambient occlusion.
   This is the screenshot people share. Gate it behind a toggle once (1) proves
   the layout and the data model.

The paper look may not need to be a separate mode at all: the viewer already has
a `data-scheme` axis (observatory, default, warm, void, dim). Drafting-paper
could be a scheme the atlas honours rather than a second app.

## Performance

Canvas 2D with painter's-algorithm depth sorting handles a few hundred buildings
comfortably; past that, instanced WebGL. Hit-testing via an offscreen colour-ID
buffer, not per-pixel geometry math — cheap and exact at any zoom.

## Prerequisite gap

`viewer/app/views/ConstellationView.pzl` (1400+ lines, route `#/constellation`)
has **no PAGE card**. Write one before this feature starts, or the atlas has
nothing to connect to and the existing renderer's decisions stay undocumented.

## Scope

- In: render, layout, lenses, flow trace, drill-down, PNG still export
  (`constellation atlas --png` makes a README image and a cover for the exported
  docs).
- Out: editing cards from the atlas; scanning the repo for structure the plan
  doesn't have; live multi-agent avatars moving through the city.

## Reference

Inspiration set: a hatched drafting-paper isometric map with hover descriptions
and go-inside drill-downs; a lit 3D "statute city" with district labels and a
stepped guided tour; a dark instanced-cuboid workspace view with shape/layout/
render/lens selectors and a timeline; a coloured isometric city with per-type
building shapes and labelled connection lines.

The prompt behind the first of those, quoted for the vocabulary it fixes:

> Turn a codebase into an interactive isometric architecture map … in the hatched
> drafting-paper style with hover descriptions, animated data-flow dots,
> go-inside drill-downs, and a step-by-step request trace.
