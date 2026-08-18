# Authoring for the atlas

The atlas (`#/constellation/atlas`) renders the plan as an isometric city:
districts are FEATURE cards, buildings are every other card, roads are FLOW
cards. It is a *render of the plan*, not an analysis of the repo — so what it
shows is exactly what you wrote, and the gaps in it are real gaps.

Read this when a plan's atlas looks empty, flat, or scattered. Everything below
is about card content; the atlas has no data of its own.

## Why the city can't lie

Every other "codebase atlas" tool scans a repo and *infers* structure into a
picture. Impressive once, wrong within a week, and nothing tells you when.

This one inverts that. The city is drawn from cards a person wrote, and drift —
bound code that changed since the card was verified — is computed live and
rendered as a **lens**: switch to it and drifted buildings stand tall in red,
wrapped in scaffolding. The map cannot quietly go stale, because staleness is
the thing it lights up.

The inverse is also honest: a card that isn't in the plan isn't in the city. A
repo with 400 files and 12 FILE cards has a visibly small city. That is a
coverage signal, not a bug — don't "fix" it by inventing cards nobody needs.

## What each thing needs to show up well

**Districts — connect cards to a FEATURE.** A FEATURE card is the district
header (its name and first sentence are the label and the caption); the cards
connected to it are the buildings inside. A card connected to no feature falls
back to a district for its type, which is honest but dull. A card connected to
several joins the *smallest* claiming feature, so a focused feature keeps its
cards.

So: when a feature is done, connect it to what it actually touched. That one
habit is the difference between a city with named neighbourhoods and a city
sorted by filing cabinet.

**Roads — give FLOW cards ordered steps.** A flow's steps are a numbered
markdown list in the body (never frontmatter). The `[[HANDLE]]` links inside
each step become the route's stops, in order, and clicking the flow walks it one
step at a time with the camera following. A FLOW with no numbered list draws no
road and cannot be traced.

Two or more stops that name real cards are the minimum. Prose refs are
aspirational, so a stop naming a card nobody wrote yet is simply skipped.

**Floors — bind code.** A building is not a solid block. Its floors come from,
in order:

1. connected FILE cards' `path:` — one floor each
2. the card's own `code_refs`, where `path:symbol` makes a **function** a floor
3. failing both, the card's `##` section headings

A card with no bindings still stands, but it is a blank tower. `code_refs:
[src/core/lint.ts:lintPlan]` is how you put a specific function in the city.

**Drift — `set_verified`.** The drift lens compares a claim card's bound files
against its `verified_sha`. A card that was never verified has no baseline and
so cannot drift — it is invisible to the most useful lens in the app. Stamp
verification when you finish work, or the lens has nothing to say.

**Height — pick a lens.** Colour and height are independent. `status` (the
default) colours by status and keeps the city flat. `degree` makes hubs tall,
`recency` raises what changed lately, `size` raises what has the most bound
code, `drift` raises and scaffolds what diverged.

## Placement you author: `atlas.json`

Optional, at the plan root. Absent means fully computed, which is the normal
case. It records only *where a person wants things* — never a graph fact, so
the nothing-derived-is-stored rule still holds:

```jsonc
{
  "districts": ["FEATURE-AUTH", "FEATURE-BILLING"],  // order; rest follow by size
  "pin":    { "DB-CORE": [4, 2] },      // cell within its district
  "shape":  { "JOB-SYNC": "plant" },    // override the type's silhouette
  "height": { "API-TICKETS": 3 },       // override the lens
  "lens":   "drift",                    // default lens
  "engine": "iso",                      // "iso" (flat shading) or "lit" (WebGL)
  "hide":   ["FILE-TSCONFIG"]           // keep noise off the map
}
```

Hand-edited — it is not a card, so it does not go through the MCP write tools.
A malformed file degrades to defaults rather than breaking the atlas.

Dragging in the viewer pans the map; it never moves a building. Placement is
computed from the graph, so a position is either derived or authored here, never
nudged.

## Don't

- **Don't add cards to make the city look fuller.** An honest small city beats a
  padded one, and every card you invent is one a future agent has to trust.
- **Don't put flow steps in frontmatter.** They live in the body; the schema
  says so and the road is built from the body.
- **Don't expect `[[links]]` alone to place a building near its neighbours.** A
  wikilink is a hyperlink, not an edge. Districts and roads come from
  `connections:` and from flow steps.
- **Don't write layout into cards.** No coordinates, no district names in
  frontmatter. Placement is computed, or authored in `atlas.json`.
