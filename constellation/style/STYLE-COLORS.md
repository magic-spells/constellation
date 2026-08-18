---
name: Colors
kind: tokens
status: built
category: color
code_refs:
  - viewer/app/styles/schemes.css
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
    value: '#07080f'
    description: The page behind everything
  - name: surface
    value: '#0c0e18'
    description: Panels, cards, the topbar
  - name: surface-sunken
    value: '#11131f'
    description: Inset wells — board columns, code blocks
  - name: border
    value: '#3a3936'
    description: Default hairline
  - name: border-strong
    value: '#4c4b47'
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
---

The base palette: four text steps, three surfaces, two borders, one brand.
Values shown are **observatory dark**, the default scheme.

## Two axes, not one

Theming is `data-scheme` (observatory, default, warm, void, dim) × `data-theme`
(light / dark / system), both stamped pre-paint by an inline script in the shell
so nothing flashes. Every token is a `light-dark()` pair, so a scheme declares
both halves once and the theme toggle picks a side.

That has a consequence worth knowing before touching print or export:
**observatory carries dark values in *both* halves**, so flipping
`color-scheme: light` does not lighten it. Paper has to redeclare the tokens
outright — see [[PAGE-VIEWER-DOCS]].

## Rules

Four text steps exist so quiet things can be quiet without inventing a grey.
`ink` is for headings and emphasis only; body copy is `body`, and dropping it to
`muted` to "soften" a paragraph is how a page ends up with no hierarchy at all.

Backgrounds mark state, borders do not: a selected row is `brand-tint`, never a
coloured border. `brand` means *you can click this* — it carries no meaning
about what something **is**. That job belongs to [[STYLE-UTILITY-COLORS]] and
[[STYLE-CARD-TYPES]].

Deliberately absent: an `info` token. A neutral notice uses `muted` on
`surface-sunken`; adding a blue for it would collide with `brand` and teach
people to ignore one of the two.
