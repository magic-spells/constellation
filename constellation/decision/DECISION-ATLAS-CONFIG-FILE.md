---
name: atlas.json, not PLAN-PROJECT frontmatter
kind: decision
status: built
section: decisions
order: 31
connections:
  - PAGE-VIEWER-ATLAS
---

Authored atlas layout lives in `constellation/atlas.json` — the plan's **second**
non-card file, after `.sync.json`. That bar is high, so this records why it was
cleared.

## It does not break "nothing derived is stored"

Everything in the file is authored *presentation*: district order, per-card pins,
silhouette and height overrides, a default lens and engine, and a hide list. Which
cards exist, what connects to what, and which feature owns a card all stay derived
from the cards and are recomputed on every load.

A pin is not a derived value — it cannot be computed from the graph at all. It is
input, like `doc_sections`. The invariant is about never persisting something the
files already imply; this persists something they don't.

## Rejected: PLAN-PROJECT frontmatter

Where `doc_sections` lives, and the obvious first choice. Rejected because the two
are different shapes: `doc_sections` is a short ordered list a person types once,
while pins are per-card coordinates that accumulate one entry per building and are
tuned by dragging. Hundreds of coordinate pairs would swamp the project card and
make its diff useless.

## Rejected: `.sync.json`

That file's own doc comment is explicit that every field in it is provenance — a
sha somebody stamped — and never a preference. Putting viewer state there would
be the first exception, and exceptions are how a marker file becomes a junk
drawer.

## Contract

Absent means fully computed, which is the normal case. Every field is optional,
unknown keys are dropped, and a malformed file degrades to defaults rather than
failing the atlas — it is hand-editable, so "mostly right" has to still work.
