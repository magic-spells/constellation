---
name: One scene, two painters
kind: decision
status: built
section: decisions
order: 30
connections:
  - PAGE-VIEWER-ATLAS
  - FILE-ATLAS-SCENE
---

The atlas ships **both** a canvas-2D isometric renderer and a lit three.js one,
user-switchable.

## Why both, and why it is cheap

The reference images that inspired this looked like two different products — a
hatched drafting-paper map and a lit dusk city — but they are the same geometry
with different paint. Two of the three references collapse to one renderer skinned
by the existing `data-scheme` axis; only real lighting needs WebGL.

So the split is not renderer-vs-renderer, it is **layout vs paint**. A pure
`atlas-scene.js` emits districts, buildings and roads in world units; both
painters consume that one scene. Neither can invent a position, so the two modes
always show the same city, and a layout fix lands once.

## Rejected: build the paper map first, add 3D later

The feature card originally proposed phasing. Dropped because the scene-graph
split makes the second painter additive rather than a rewrite, and because the
choice is genuinely a matter of taste — paper prints and reads, lit is the one
people share.

## three is vendored, not bundled

Measured: a plain `import('three')` took `app.js` from 431 KB to 1.1 MB, because
the puzzle build emits a single file and does **not** split dynamic imports. Every
reader would have paid for a view most never open.

`scripts/copy-three.mjs` copies three's ESM build into the viewer's `public/`
and `loadThree()` imports it through a variable URL, so esbuild leaves the import
alone and the browser fetches it on the first switch. `app.js` is 458 KB. This is
exactly the trick mermaid already uses, and it is the reason the precedent was
worth following rather than reinventing.

## Known asymmetry

The lit engine has no equivalent of the paper scheme's hatching and ink outlines,
so switching engines while in the `warm` scheme is a bigger visual jump than in
any other. Accepted: `warm` is the scheme where the paper map is the point.
