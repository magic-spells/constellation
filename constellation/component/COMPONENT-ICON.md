---
name: Icon
kind: ui
status: built
code_refs:
  - viewer/app/components/Icon.pzl
  - viewer/app/lib/icons.js
connections:
  - PAGE-VIEWER-HOME
---

One stroke glyph from the viewer's own icon set, drawn on `currentColor`.

`viewer/app/lib/icons.js` holds Lucide-style 24×24 paths inline — the viewer ships as static assets with no reachable CDN, and an icon font for a dozen glyphs is more machinery than the dashboard. Each icon is an array of `{ k, d }` so multi-path glyphs render from one loop. `STATE_ICON` maps a sync state to its glyph + tone, `CHANGE_ICON` maps a FEATURE `change:` group to its glyph.

The colour trick: nothing sets a per-icon palette. Tone is set once on the surrounding row (success / warning / danger / brand / muted) and the glyph inherits it through `currentColor`, so the same icon reads correctly in every state and both themes. Used across [[PAGE-VIEWER-HOME]]'s health strip and panels.
