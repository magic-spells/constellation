---
name: Board card preview dialog
status: built
release: RELEASE-V0-5-0
change: feature
branch: release/0.5.0
connections:
  - PAGE-VIEWER-BOARD
  - PAGE-VIEWER-CARD
---

Clicking a card on [[PAGE-VIEWER-BOARD]] used to leave the board for the card
page. It now opens a centred preview dialog that **morphs out of the card you
clicked**, and flies back into it on close — ✕, backdrop, Escape, or the browser
Back button, all the same path.

The board answers "where is everything right now". Leaving it to read one card
threw that away and made you navigate back; a preview keeps the board on screen
and makes scanning several cards in a row cheap. Read-only, like the board:
editing stays on the card page, one link away in the dialog's footer.

## Scope

- `BoardCardDialog.pzl` — the routed overlay: type-tinted handle, name, status,
  rendered body, connections grouped by type, "Open full card →".
- `BoardOverlayEmpty.pzl` — the index child, the "no dialog open" state.
- `BoardPage.pzl` — a `<Slot/>`, plus per-card `href` and morph pairing id.
- `KanbanCard.pzl` — optional `card.morph` → `data-puzzle-morph` on the root.
- `routes.js` — `/board` gains `children: ['', 'card/:handle']`.
- `app.js` — `enableMorph(app)`, tuned per leg.
- `AppShell.pzl` — the Board nav row stays lit while the dialog is open.

## Why a child route

A `{#if}`-toggled dialog cannot morph. The board and the clicked card have to
stay mounted for the blob's whole round trip, and a patch-time removal cannot be
awaited — so the dialog is a child route rendered in BoardPage's `<Slot/>`, the
shape puzzle's D55 shared-element morph requires. That is also what makes the
Back button fly it home: same pipeline, no extra code.

## Notes

The two legs are tuned separately through morph-engine's `hide` bag (≥0.2.0,
which the dep was bumped to for this): a springy open, a calmer close. Attraction
buys speed and *pays* in overshoot — friction is what spends it, so the two out
numbers move together.

Verifying this in a driven browser tab is misleading: `requestAnimationFrame` is
suspended while `document.visibilityState` is `hidden`, so the spring appears to
freeze mid-flight and `hide()` never resolves. It is not a bug in the
integration — force frames, or watch it in a foreground window.
