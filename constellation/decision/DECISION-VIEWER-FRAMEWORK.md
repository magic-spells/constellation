---
name: The viewer is a Puzzle app, not a Svelte app
status: built
connections:
  - PAGE-VIEWER-HOME
  - PAGE-VIEWER-CARD
  - PAGE-VIEWER-FEATURES
  - COMPONENT-EDITABLE
  - COMPONENT-STATUS-SELECT
  - COMPONENT-SYNC-BADGE
  - FILE-SERVE
---

# The viewer is a Puzzle app, not a Svelte app

## Context

`viewer/` shipped as a Svelte 5 + Vite SPA. That pulled a second frontend
toolchain into a repo whose only other build step is `tsc`, and every piece of
UI — sidebar, dialogs, command palette, split panel, toasts, selects — was
hand-rolled, so the viewer's surface grew slower than the plan format it
renders. Constellation and Puzzle are both Magic Spells projects; running the
viewer on our own framework makes it a real consumer of it.

## Decision

Rebuild the viewer as a **Puzzle** SPA (`viewer/app/**/*.pzl`, hash router)
styled with **puzzle-pieces** + Tailwind v4, built by the `puzzle` CLI. Landed
in 0.5.0. The Svelte sources (`viewer/src/`, `viewer/index.html`,
`viewer/vite.config.ts`, `viewer/tsconfig.json`) are deleted, and with them the
`svelte`, `@sveltejs/vite-plugin-svelte`, `vite`, `@tailwindcss/vite` and
`svelte-check` dev dependencies.

What deliberately did **not** change:

- **The server contract.** [[FILE-SERVE]] is untouched: the build still emits
  `viewer/dist/index.html` + assets, and the read/write API and SSE reload are
  the same. Only the app inside `viewer/` changed.
- **The URL shapes.** Hash routing is kept, so `#/card/<HANDLE>` deep links and
  every `[[HANDLE]]` wikilink anchor keep working.
- **The constellation graph.** The imperative d3-force + canvas layout ported
  across nearly verbatim (`viewer/app/lib/constellation-layout.js`) — it was
  never framework-coupled.

Theming is now two axes: a **scheme** (`data-scheme` — observatory, default,
warm, void, dim) and a **theme** (`data-theme` — light / dark / system), both
set pre-paint by an inline script in the shell. Observatory, ported from the
old viewer, is the default and is always dark.

## Alternatives

- **Keep Svelte, adopt a component library** — rejected: it would have kept the
  second toolchain and still meant importing someone else's design system.
- **Server-rendered HTML, no SPA** — rejected: the graph canvas, the ⌘K palette
  and live reload all want a client runtime, and the viewer is already served
  from `viewer/dist` as static assets.

## Consequences

- Building the viewer needs the `puzzle` CLI (a platform binary shipped by the
  `@magic-spells/puzzle` dev dependency); `npm run build:viewer` runs
  `puzzle build --mode production` with cwd `viewer/`.
- Pieces copied in by `puzzle add piece` live in `viewer/app/components/ui/` and
  are **our** code — edit them freely; `viewer/pieces.lock` hashes drift on
  purpose when we do.
- The published package is unaffected: it still ships `viewer/dist`, and no
  runtime dependency was added.
