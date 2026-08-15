---
name: v0.5.0 — Puzzle viewer
version: 0.5.0
status: built
---

# v0.5.0 — Puzzle viewer

The viewer rebuilt on Puzzle + puzzle-pieces (from Svelte), and the Overview page
grown from a landing page into a status board. Theme: make the viewer the
day-to-day cockpit for a plan, not just a browser for it.

## Upgrading

No migration steps — the viewer is served from `viewer/dist` either way, and
everything below is additive.

**New: `change:` on FEATURE cards** (`feature` | `fix` | `breaking` | `chore`,
unset reads as `feature`). It is how a release describes itself without anyone
writing a changelog: the features pointing at a RELEASE group by it wherever the
release is rendered. Existing FEATURE cards need no edit — set `change: breaking`
on the ones that deserve it and the grouping appears.

**Behaviour change: a card may bind a directory.** `code_refs: [tests]` used to
resolve as a missing file, so the card read as permanently stale while real drift
under the folder never registered. A directory now resolves as present, and drift
over it matches anything underneath. Cards bound to a folder will change their
drift verdict on upgrade — from wrong to right.
