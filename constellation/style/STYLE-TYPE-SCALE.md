---
name: Type scale
kind: tokens
status: built
category: type-scale
code_refs:
  - viewer/app/components/DocsDocument.pzl
tokens:
  - name: heading-1
    value: 3.25rem
    weight: '700'
    line_height: '1.04'
    description: Document title — clamps down to 2.2rem on narrow viewports
  - name: heading-2
    value: 2.1rem
    weight: '680'
    line_height: '1.15'
    description: Section title
  - name: heading-3
    value: 1.5rem
    weight: '640'
    line_height: '1.25'
    description: Card title inside a document
  - name: overline-heading
    value: 0.72rem
    weight: '600'
    line_height: '1.4'
    sample: DOCUMENTATION
    description: Label above a heading — uppercase, letterspaced
  - name: body-lg
    value: 1.0625rem
    line_height: '1.72'
    description: Document prose — the reading size
  - name: body-md
    value: 0.875rem
    line_height: '1.5'
    description: 'UI default: rails, panels, tables, forms'
  - name: body-sm
    value: 0.75rem
    line_height: '1.45'
    description: Meta text, counts, timestamps
connections:
  - PAGE-VIEWER-DOCS
  - STYLE-FONTS
section: design-system
order: 20
---

Seven steps. Heading steps are **numbered to match the element they set** —
`heading-2` is what an `h2` gets — so nobody has to remember whether
"subheading" sat above or below "title". Nothing is called `display` (it invites
an eighth size above the top step) and nothing is called `overline` (Tailwind
owns that as a text-decoration utility).

## Two reading sizes, on purpose

The app runs at `body-md` (14px) and the compiled document at `body-lg` (17px).
That is not drift. Chrome is scanned — rails, counts, table rows — and wants
density; a document is *read*, and 14px prose with UI line-height is punishing
for anything longer than a panel. [[PAGE-VIEWER-DOCS]] steps up deliberately and
lengthens the leading to 1.72 with it.

The same logic sets the document column at 48rem rather than the 70rem used for
panel prose: measure follows size, and 70rem at 17px is far past a readable
line.

## Notes

`heading-1` is the only clamped step (`clamp(2.2rem, 5vw, 3.25rem)`) because it
is the only one that ever has a whole viewport to itself.

UI text is set with Tailwind's utilities rather than these tokens; the values
here are the contract those utilities happen to satisfy. If the two ever
disagree, this card is wrong — it is bound to `DocsDocument.pzl`, so
`stale_report` will say so.
