---
name: Viewer — board
kind: route
status: built
code_refs:
  - viewer/app/views/BoardPage.pzl
  - viewer/app/components/ui/Kanban.pzl
  - viewer/app/components/ui/KanbanCard.pzl
connections:
  - FILE-SERVE
  - COMPONENT-STATUS-SELECT
  - PAGE-VIEWER-FEATURES
---

The `#/board` route: every FEATURE card as a Kanban board, one column per value of
the `status:` enum — *Planned*, *Building*, *Built*, *Verified*. Served by
[[FILE-SERVE]]; the sidebar entry sits directly under Overview and is always
present, because the board is a fixed view of the plan's work rather than a row
that only exists when some type has cards.

A card's column **is** its status — nothing about the board is stored. Columns
sort by file mtime, freshest edit first, and each card stays terse: name, handle,
and one clamped line of intent lifted from the first real paragraph of its body
(cards carry no summary field, so that is the closest honest thing to one).
Clicking a card goes to its card page, where [[COMPONENT-STATUS-SELECT]] is the
thing that actually moves it.

A card with **no** status sits in Planned — that is what an unstated status means
for work — but says so in a quiet dashed pill, so an unset field never
masquerades as a decision. An unrecognised status lands there too rather than
vanishing off the board.

**Read-only for now.** Drag-between-columns is a `status` flip through the
existing PATCH write API ([[FILE-SERVE]] → [[FILE-WRITER]]), so it needs no new
write path — but it needs one that is byte-preserving and lint-checked, and that
lands later. The `kanban` puzzle-piece was copied in with its pointer + keyboard
drag model and the drag half was **removed rather than disabled**: its
`role="button"` / `tabindex` / `aria-grabbed` semantics fight the plain links a
read-only board wants, and dormant machinery would have lied about what the board
does. `Kanban.pzl`'s header records how to re-merge the original when the status
flip ships.

[[PAGE-VIEWER-FEATURES]] is the same cards asked a different question — ahead vs
shipped, with release / branch / PR provenance. The board answers "where is
everything right now".
