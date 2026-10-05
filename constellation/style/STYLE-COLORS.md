---
name: Colors
kind: tokens
status: verified
category: color
code_refs:
  - viewer/app/styles/schemes.css
  - viewer/app/styles/pieces.css
  - viewer/app/styles/themes/dim.css
  - viewer/app/styles/themes/warm.css
  - viewer/app/styles/themes/void.css
  - viewer/app/lib/appearance.js
tokens:
  - name: ink
    value: '#e6e8f2'
    description: Headings and emphasis — the strongest text
  - name: body
    value: '#cfd5e8'
    description: Running text
  - name: muted
    value: '#8d93ad'
    description: Labels, secondary text
  - name: faint
    value: '#5a5f78'
    description: Placeholders, disabled, quiet meta
  - name: page
    value: '#03040a'
    description: The page behind everything — the darkest layer
  - name: surface-frame
    value: '#03040a'
    description: The window frame — rail and the margin around the work panel; the page in dark
  - name: surface-sunken
    value: '#07080f'
    description: The card-list pane and inset wells — board columns, code blocks
  - name: surface-panel
    value: '#0a0c15'
    description: The work panel's ground (= surface-base); canvases paint it
  - name: surface
    value: '#0e101b'
    description: Panels and cards
  - name: surface-raised
    value: '#121522'
    description: The top step, above cards
  - name: border
    value: '#1b1e30'
    description: Default hairline
  - name: border-strong
    value: '#2a2e48'
    description: Hover and emphasis borders
  - name: brand
    value: '#8ab4ff'
    description: Links and primary actions
  - name: brand-tint
    value: '#1b2440'
    description: Selected rows, active nav — echoes the starfield glow
connections:
  - PAGE-VIEWER-HOME
  - STYLE-UTILITY-COLORS
  - STYLE-CARD-TYPES
section: design-system
order: 30
verified_at: '2026-10-05T00:02:43.606Z'
verified_sha: 3ad1a1ec1e242169a4743bd17cc36b22e58b9a6c
notes:
  - kind: verified
    text: >-
      Re-checked after viewer i18n (#46), the Observatory dark retune (bbbf885) and the header
      language globe (e2004a4); card fixes in f457fd1 and 3ad1a1e.
    sha: 3ad1a1ec1e242169a4743bd17cc36b22e58b9a6c
---

The base palette: four text steps, six surfaces, two borders, one brand.
Values shown are **observatory dark**, the default scheme.

## Depth order

Dark follows the pieces default order, every step on the navy axis: frame/page
`#03040a` < sunken `#07080f` < panel/base `#0a0c15` < surface/card `#0e101b` <
raised `#121522`. `bar-hover` is `color-mix(#03040a 85%, #8d93ad)`. In 1.0 the
work panel was the page, the darkest layer, so the content read as a hole; 1.1
changed the dark `page` value (it was `#07080f`). Light is unchanged. Medium
keeps 1.0's aliases: `surface-panel: var(--color-page)` and
`surface-raised: var(--color-surface)`.

## Two axes, not one

Theming is `data-scheme` (observatory, default, dim, warm, void) × `data-theme`
(light / medium / dark, or unset to follow the OS), applied by `lib/appearance.js`
and stamped pre-paint by an inline script in `index.html` so nothing flashes.
Every token is a `light-dark()` pair; medium takes the dark half and each scheme
adds a medium block that lifts the grounds.

Observatory is ours (`schemes.css`), scoped to `[data-scheme='observatory']`
rather than `:root` so the picker can preview it on a card, and it restates all
71 tokens for the same reason. The default palette is `pieces.css`; dim, warm and
void are registry copies in `styles/themes/`, changed only by `puzzle add theme`.

No scheme's light half is paper white, and medium blocks set literals, so print
redeclares the tokens outright — see [[PAGE-VIEWER-DOCS]].

## Rules

Four text steps exist so quiet things can be quiet without inventing a grey.
`ink` is for headings and emphasis only; body copy is `body`, and dropping it to
`muted` to "soften" a paragraph is how a page ends up with no hierarchy at all.

Backgrounds mark state, borders do not: a selected row is `brand-tint`, never a
coloured border. The one exception is the rail's active row in Observatory light,
a near-white raised chip, because the tint sat too close to the grey frame.
`brand` means *you can click this* — it carries no meaning about what something
**is**. That job belongs to [[STYLE-UTILITY-COLORS]] and [[STYLE-CARD-TYPES]].

Deliberately absent: an `info` token. A neutral notice uses `muted` on
`surface-sunken`; adding a blue for it would collide with `brand` and teach
people to ignore one of the two.
