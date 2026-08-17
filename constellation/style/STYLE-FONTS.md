---
name: Fonts
kind: tokens
status: built
category: font
code_refs:
  - viewer/app/styles/fonts.css
tokens:
  - name: sans
    value: '''Inter Variable'', ''Inter'', system-ui, -apple-system, ''Segoe UI'', sans-serif'
    role: Heading Font
    weights: Variable 100–900
    src: viewer/app/public/fonts/inter-latin-variable.woff2
    description: 'Everything: headings and running text alike'
  - name: mono
    value: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace
    role: Mono
    weights: Regular (400) · Semibold (600)
    description: Handles, code, paths — system stack, nothing shipped
connections:
  - PAGE-VIEWER-HOME
  - PAGE-VIEWER-DOCS
  - STYLE-TYPE-SCALE
section: design-system
order: 10
---

One shipped family, one system stack.

`sans` is **Inter, bundled** — a variable woff2 served from the viewer, not a
request to the reader's machine. It replaced `'Avenir Next', Seravek, 'Gill
Sans', 'Segoe UI'`, which exists on macOS and essentially nowhere else: Windows
and Linux silently landed on Segoe UI or Gill Sans, so the viewer looked like a
different product per platform and nobody on a Mac could see it happening.

Hierarchy comes from size and weight, not from mixing families — `--font-display`
is an alias of `--font-sans`, kept as a seam in case that ever stops being true.
A scheme is a **palette**: no scheme overrides the typeface.

## Why the faces are hand-declared

`@fontsource-variable/inter` is a devDependency, but its stylesheet is not
imported. The puzzle build inlines an imported CSS file verbatim without
rewriting or emitting its `url(./files/…)` references, so every face 404s and
the stack falls through to whatever the reader has installed. That failure is
invisible on any machine that already has Inter — which is most developer
machines, and was exactly how it was nearly missed.

So two subsets (latin, latin-ext ≈ 133KB) are copied into
`viewer/app/public/fonts/`, which the build does copy, and declared by hand with
`unicode-range` so a reader fetches only the subset their text touches. Update by
`npm update` then re-copying.

## Mono is deliberately not shipped

Every platform has a good monospace and code is the one place a local face is
welcome. Worth knowing: a specimen naming a font nobody has renders in the
fallback while still printing the name in large type — the golden example plan
claims JetBrains Mono and silently renders `ui-monospace` on most machines. That
is what the `src:` field exists to prevent, and why `sans` above sets it.
