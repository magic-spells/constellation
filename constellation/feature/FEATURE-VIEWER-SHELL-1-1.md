---
name: Viewer shell on puzzle 0.8
status: built
release: RELEASE-V1-1-0
change: feature
branch: feat/viewer-shell-1-1
pr: '#42'
code_refs:
  - viewer/app/layouts/AppShell.pzl
  - viewer/app/components/NavDrawer.pzl
  - viewer/app/components/AppearanceSwitcher.pzl
  - viewer/app/components/CommandPalette.pzl
  - viewer/app/components/ui/Command.pzl
  - viewer/app/lib/appearance.js
  - viewer/app/lib/motion.js
  - viewer/app/lib/narrow.js
  - viewer/app/public/index.html
  - viewer/pieces.lock
connections:
  - PAGE-VIEWER-HOME
  - PAGE-VIEWER-CARD
  - PAGE-VIEWER-DOCS
  - PAGE-VIEWER-CONSTELLATION
  - PAGE-VIEWER-ATLAS
  - STYLE-COLORS
  - STYLE-UTILITY-COLORS
  - COMPONENT-SYNC-BADGE
  - FEATURE-PUZZLE-VIEWER
---

Move the viewer onto puzzle 0.8 and puzzle-pieces 0.8, and rebuild the shell around it: one framed work panel, a search that grows into the palette, a three-mode appearance picker, and a phone layout.

## Scope

- **Puzzle 0.8, morph-engine 0.4.2.** Formatter pipes are gone: `{x|link}` is `{link(x)}`. `pieces.lock` reads `npm:@magic-spells/puzzle-pieces@0.8.0`. Refreshed: the theme (`pieces.css`, 71 tokens, light/medium/dark; dim/warm/void in `styles/themes/`), SearchField, Sidebar, AppearancePicker. Command is the org app-template's morph version.
- **Shell** ([[PAGE-VIEWER-HOME]]): rail and window are one `surface-frame`; the work panel is inset 12px with all corners rounded, its header inside it.
- **Search → palette.** Centred in the header, it morph-opens the command palette; ⌘K finds the same source through `data-morph-source="search"`. Springs live in `lib/motion.js` (close attraction 0.18); reduced motion gets a fade. Keys typed mid-flight go into the query and Escape dismisses. Focus returns to whatever was focused at open, because the morph source is geometry only.
- **Phones (below `md`):** `NavDrawer` replaces the rail; a folder shows its list or one card ([[PAGE-VIEWER-CARD]]).
- **Appearance:** `AppearanceSwitcher` (a header popover around AppearancePicker) and `lib/appearance.js` replace ThemeControls and `lib/theme.js`. Observatory stays first and default with its 30 values unchanged, now restating all 71 tokens plus a medium block ([[STYLE-COLORS]]). The pre-paint script paints Observatory, validates what storage holds and migrates the old keys once.
- **Canvases and print** follow the new tokens: [[PAGE-VIEWER-CONSTELLATION]], [[PAGE-VIEWER-ATLAS]], [[PAGE-VIEWER-DOCS]].

## Decisions

- **Dialog, AlertDialog, Tabs and SplitPanel stay on their 0.6 copies.** 0.8 moved them onto web components (dialog-panel, tab-group, split-panel) with new APIs. The 0.6 copies run under puzzle 0.8, so porting them is its own change, not part of this one.
- **NavDrawer is hand-built, not the pieces Sheet.** Sheet needs the dialog-panel package, the same move deferred above. A native `<dialog>` already traps focus, inerts the page and turns Escape into `cancel`.
- **The drawer closes before it navigates.** A link asks the shell to close it and the shell routes once the sheet is gone; routing while it is still modal leaves the router unable to focus the incoming view.
