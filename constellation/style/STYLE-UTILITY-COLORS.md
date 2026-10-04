---
name: Utility colors
kind: tokens
status: verified
category: color
code_refs:
  - viewer/app/styles/schemes.css
  - viewer/app/styles/pieces.css
  - viewer/app/styles/themes/dim.css
  - viewer/app/styles/themes/warm.css
  - viewer/app/styles/themes/void.css
tokens:
  - name: success
    value: '#66b35c'
    description: Verified, in sync, passing
  - name: success-tint
    value: '#121c18'
    description: Success background
  - name: warning
    value: '#d9a23c'
    description: Building, drifted, needs attention
  - name: warning-tint
    value: '#201a14'
    description: Warning background
  - name: danger
    value: '#e0635d'
    description: Errors, destructive actions
  - name: danger-tint
    value: '#211318'
    description: Danger background
  - name: danger-ink
    value: '#1a0e0f'
    description: Text ON danger — dark, not white
connections:
  - STYLE-COLORS
  - COMPONENT-SYNC-BADGE
  - PAGE-VIEWER-BOARD
section: design-system
order: 40
notes:
  - kind: state
    text: >-
      The token values above are Observatory's dark halves (`schemes.css`). Observatory light
      deepens each hue (success #45803d, warning #8f6a1a, danger #c04840, pale tints), medium mixes
      its tints toward the hue, and default/dim/warm/void use the pieces palettes' own status
      colours (pieces.css, themes/*.css), so the borrowing from `--t-API` / `--t-DB` / `--t-TEST`
      holds only in Observatory dark.
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
verified_at: '2026-10-04T22:03:30.324Z'
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

The three colours that carry meaning, each with a tint for backgrounds.

They are not decorative and they are not free: a status colour maps to plan
state everywhere. `success` is verified and in-sync, `warning` is building or
drifted, `danger` is an error or a destructive action. The board's column dots,
the card list's status dots and [[COMPONENT-SYNC-BADGE]] all read from these, so
a status is one colour in every view.

The hues are borrowed from three of the card-type tones in
[[STYLE-CARD-TYPES]] — `danger` is `--t-API`, `warning` is `--t-DB`, `success`
is `--t-TEST` — which is why status and type never clash on the same screen.

## The one that looks like a mistake

`danger-ink` is **dark**, not white, in dark mode. On a salmon red that light,
white text reaches only about 3.3:1 while `#1a0e0f` reaches 5.9:1. Any "fix" that
makes it white for consistency is a contrast regression. Light mode deepens the
red to `#c04840`, where white is the right ink and is what it uses.

Tints are each hue at 12% over `#07080f` — 1.0's dark page, which is
`surface-sunken` since the 1.1 depth retune ([[STYLE-COLORS]]) — so they stay
legible without becoming a second surface colour. The retune left them as they were.
