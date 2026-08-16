---
name: 'Tasks: board and list as one destination'
status: built
release: RELEASE-V0-5-1
change: feature
branch: feat/tasks-tabs
connections:
  - PAGE-VIEWER-BOARD
  - PAGE-VIEWER-FEATURES
---

Board and the features list were two sidebar rows. They are not two things —
they render the SAME FEATURE cards and differ only in the question they answer.
So they became two tabs behind a single **Tasks** row.

The old rail also carried two entries reading "Features": the roadmap page, and
the FEATURE *type* row in the Overview group right below it. Same word, two
different pages. Collapsing the pair removed that, and took the top section from
four rows to three.

## Scope

- `TasksHeader.pzl` — the shared title + tab strip both views render.
- `routes.js` — `/tasks/board` and `/tasks/list`; `/tasks` resolves to board.
  `/board` and `/features` stay as redirects.
- `AppShell.pzl` — one Tasks row; every `tasks*` route highlights it.
- `CommandPalette.pzl` — both views listed, ungated.
- `FeaturesPanel.pzl` — same container as the board (see below).

## Why the tabs navigate

They are routes, not an in-place toggle, because everything else in this viewer
is URL-driven: deep links, the Back button, and the board's own morph dialog
([[FEATURE-BOARD-PREVIEW-DIALOG]]) all depend on it. A local toggle would be the
one view where the URL stopped describing what you were looking at. It also
means Back steps between views, which is what a reader expects from a tab.

## Notes

The two views must share a container. They did not at first: the list was
`width: min(100%, 62rem); margin: 0 auto` while the board was full-width and
left-aligned, so the heading and tab strip jumped ~450px sideways when you
switched — the one thing a tab strip must never do. The cap moved onto the
content rows instead.

Gotcha worth keeping: a callback prop's arguments are NOT identifiers a template
expression can name. `@change={ go(value) }` passes undefined; the bare
`@change={ go }` is what receives `(value, event)`. The Tabs piece documents the
bare form, and the call form fails silently — the tab renders, highlights, and
does nothing.
