---
name: Card type hues
kind: tokens
status: built
category: color
code_refs:
  - viewer/app/styles/schemes.css
  - viewer/app/styles/handles.css
tokens:
  - name: t-API
    value: '#e0635d'
    description: API
  - name: t-DB
    value: '#d9a23c'
    description: DB
  - name: t-DATATYPE
    value: '#3fb8a0'
    description: DATATYPE
  - name: t-ROLE
    value: '#c47fd1'
    description: ROLE
  - name: t-DOC
    value: '#6a9fef'
    description: DOC
  - name: t-DECISION
    value: '#7d84dd'
    description: DECISION
  - name: t-FILE
    value: '#8a8f98'
    description: FILE — grey on purpose
  - name: t-TEST
    value: '#66b35c'
    description: TEST
  - name: t-EXTERNAL
    value: '#e0894a'
    description: EXTERNAL
  - name: t-EVENT
    value: '#d9b53c'
    description: EVENT
  - name: t-COMPONENT
    value: '#4cb3c9'
    description: COMPONENT
  - name: t-PAGE
    value: '#5d9fe0'
    description: PAGE
  - name: t-JOB
    value: '#b8845f'
    description: JOB
  - name: t-FLOW
    value: '#9d7cd8'
    description: FLOW
  - name: t-STATE
    value: '#4faf92'
    description: STATE
  - name: t-DIAGRAM
    value: '#e07fae'
    description: DIAGRAM
  - name: t-AGENT
    value: '#84b35c'
    description: AGENT
  - name: t-PLAN
    value: '#d9c06a'
    description: PLAN
  - name: t-FEATURE
    value: '#f08c1a'
    description: FEATURE
  - name: t-RELEASE
    value: '#cc5577'
    description: RELEASE
  - name: t-STYLE
    value: '#cc6fb0'
    description: STYLE
connections:
  - STYLE-COLORS
  - DOC-CARD-TYPES
  - PAGE-VIEWER-CARD
section: design-system
order: 50
---

One hue per card type, and the reason the viewer is legible at a glance: a
handle, a connection chip, a graph node and a board card all tint from the same
token, so a type is one colour everywhere. The 21 types are listed in
[[DOC-CARD-TYPES]].

## How a component gets the colour

Never by a per-type class. The renderer sets a custom property inline —
`style="--c: var(--t-FEATURE)"` — and the component styles against `var(--c)`.
One rule covers all 21, and adding a 22nd type needs no CSS at all.

The alternative (`.card-handle--feature` and twenty siblings) was rejected: it
is a fifth place to edit when a type is added, on top of the four
`CLAUDE.md` already names, and it fails **silently** — a new type simply renders
uncoloured.

## Notes

`t-FILE` is grey on purpose. FILE cards are the most numerous card in a mature
plan and a 21st bright hue would make the graph read as noise; grey lets code
recede behind the things that describe it.

Eight of these are re-exported as `--color-chart-1..8`, ordered to mirror the
base palette's hue sequence so any chart keeps its slot semantics across
schemes. Three more are the status colours in [[STYLE-UTILITY-COLORS]].

The hues are shared across every scheme rather than re-tuned per scheme — they
are identity, not palette.
