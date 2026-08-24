---
name: Constellation — the node graph
kind: page
status: verified
route: /constellation/graph
section: viewer
order: 40
connections:
  - FILE-SERVE
  - FEATURE-PUZZLE-VIEWER
  - PAGE-VIEWER-ATLAS
verified_at: '2026-08-24T21:11:31.259Z'
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
---

The force-clustered node view: **what connects to what**. One of two readings of
the same graph behind the Constellation destination — the other is
[[PAGE-VIEWER-ATLAS]].

This card exists because the view did not have one for two releases while it grew
to 1400 lines, and the decisions below were living only in its header comment.

## Layout is settled once, never live

d3-force runs **synchronously off-screen** — 260 ticks on first layout, 70 on a
reseed — and is then stopped. The simulation never ticks inside the animation
loop. Settled positions are cached per node as its "home", and a reseed happens
only when the plan's generation counter changes.

That is deliberate: live physics means the graph is never the same twice, and a
reader loses the spatial memory that makes a map worth having. Motion between
states is a **tween**, not a simulation.

## Focus is analytic, not physical

Clicking a card switches to an ego view: BFS hop distance from the focused card,
capped at 2 hops / 90 nodes, laid out as one concentric ring per hop. Ring radius
grows to fit the arc each card reserves, so cards never overlap. No forces are
involved — the ring positions are computed directly.

## The overview draws no edges

A plan of this size has 150+ connections, and drawing them all at once is a
hairball that says nothing. Edges appear only for the hovered or focused card,
or while searching. The atlas made the same call for the same reason.

## Rendering

Canvas 2D, on-demand: one `requestAnimationFrame` is scheduled only while a tween
is running or a draw was requested, so a settled graph costs nothing. Two passes —
world space for edges and card rects, then screen space for labels, so text never
inherits the zoom. Per-type colour comes from the `--t-<TYPE>` custom properties,
resolved once per theme change rather than per frame.

The camera, easing and frame scheduler live in `canvas-camera.js`, shared with the
atlas so the two canvases cannot drift apart.
