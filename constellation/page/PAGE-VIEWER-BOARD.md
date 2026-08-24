---
name: Viewer — board
kind: route
status: verified
code_refs:
  - viewer/app/views/BoardPage.pzl
  - viewer/app/views/BoardCardDialog.pzl
  - viewer/app/views/BoardOverlayEmpty.pzl
  - viewer/app/components/ui/Kanban.pzl
  - viewer/app/components/ui/KanbanCard.pzl
connections:
  - FILE-SERVE
  - COMPONENT-STATUS-SELECT
  - PAGE-VIEWER-FEATURES
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
verified_at: '2026-08-24T21:11:28.291Z'
notes:
  - kind: verified
    text: >-
      Re-read against the board sources: the card now describes the preview dialog, the child route,
      and the morph pairing, and code_refs covers BoardCardDialog/BoardOverlayEmpty. The old
      "clicking a card goes to its card page" claim is gone.
    sha: 6f66e728480fbcdf6d43f359c23c7c9732269fdd
  - kind: verified
    text: >-
      Route moved to #/tasks/board (dialog #/tasks/board/card/HANDLE) and the card now records that
      Board is one of two Tasks tabs, not a destination. Checked against routes.js, BoardPage.pzl
      and TasksHeader.pzl.
    sha: dbaa7fc23fb5a41ce5672978f990c3080c3e5f3a
  - kind: verified
    text: >-
      Verified the 20-card Verified cap, verified_at ordering with fallbacks, total badge, overflow
      link, preview route, and read-only drag state.
    sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
section: viewer
order: 20
---

The `#/tasks/board` route: every FEATURE card as a Kanban board, one column per value of
the `status:` enum — *Planned*, *Building*, *Built*, *Verified*. Served by
[[FILE-SERVE]]; the sidebar entry sits directly under Overview and is always
present, because the board is a fixed view of the plan's work rather than a row
that only exists when some type has cards.

A card's column **is** its status — nothing about the board is stored. Planned,
Building, and Built sort by file mtime, freshest edit first. Verified is the
archive-like column that never drains, so it sorts by `verified_at` (mtime and
handle break ties), shows the 20 most recently verified cards, keeps the full
count in its badge, and links any overflow to the complete List view.

Each card stays terse: name, handle, and one clamped line of intent lifted from
the first real paragraph of its body (cards carry no summary field, so that is
the closest honest thing to one). Clicking a card opens its preview dialog
(below) rather than leaving the board; the card page that dialog links on to is
where [[COMPONENT-STATUS-SELECT]] is the thing that actually moves it.

A card with **no** status sits in Planned — that is what an unstated status means
for work — but says so in a quiet dashed pill, so an unset field never
masquerades as a decision. An unrecognised status lands there too rather than
vanishing off the board.

**Preview dialog.** A card opens at `#/tasks/board/card/HANDLE` as a centred dialog
that *morphs out of the card you clicked* — type-tinted handle, name, status,
the rendered body, its connections grouped by type, and a link on to the full
card page. Closing (✕, backdrop, Escape, or the browser Back button) flies it
back into the same card. Read-only, like the board: nothing in it writes.

Three things make the morph work and they have to agree. The dialog is a **child
route** rendered in BoardPage's `<Slot/>` — not an `{#if}` toggle, because the
board and the clicked card must stay mounted for the blob's whole round trip and
a patch-time removal cannot be awaited. Both sides carry
`data-puzzle-morph="board-card-HANDLE"`, minted from the same handle, which is
what the router pairs on. And `enableMorph(app)` in `viewer/app/app.js` is the
entire opt-in — tuned per leg via morph-engine's `hide` bag (a springy open, a
calmer close; attraction buys speed and pays in overshoot, friction spends it).

Two constraints the shell must keep: it is a real `<dialog>` used **non-modally**
(a static `open`, never `showModal` — the top layer paints over the morph blob
and breaks the reveal), and it carries no changing `style={}` binding, because
the patcher rewrites the whole style attribute and would clobber the engine's
inline frames. The type hue therefore lands on an inner header, not the shell.

**Drag is still read-only.** Drag-between-columns is a `status` flip through the
existing PATCH write API ([[FILE-SERVE]] → [[FILE-WRITER]]), so it needs no new
write path — but it needs one that is byte-preserving and lint-checked, and that
lands later. The `kanban` puzzle-piece was copied in with its pointer + keyboard
drag model and the drag half was **removed rather than disabled**: its
`role="button"` / `tabindex` / `aria-grabbed` semantics fight the plain links a
read-only board wants, and dormant machinery would have lied about what the board
does. `Kanban.pzl`'s header records how to re-merge the original when the status
flip ships.

**One of two Tasks views.** Board and [[PAGE-VIEWER-FEATURES]] render the SAME
cards — every FEATURE in the plan — and differ only in the question they answer:
the board says "where is everything right now", the list says what is ahead
versus shipped with release / branch / PR provenance. Since 0.5.1 they are
therefore two tabs behind a single **Tasks** row in the sidebar rather than two
destinations, sharing a heading and tab strip (`components/TasksHeader.pzl`).
Two rows also put a second "Features" in the rail directly above the FEATURE
*type* row — the same word for two different pages.

The tabs NAVIGATE (`#/tasks/board`, `#/tasks/list`) rather than toggling in
place, because everything else here is URL-driven — deep links, Back, and this
board's own morph dialog. Both views therefore share one container so the tab
strip does not shift when you switch. The pre-0.5.1 `#/board` and `#/features`
still resolve as redirects.
