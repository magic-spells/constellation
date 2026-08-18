---
name: Utility colors
kind: tokens
status: built
category: color
code_refs:
  - viewer/app/styles/schemes.css
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

`danger-ink` is **dark**, not white. On a salmon red that light, white text
reaches only about 3.3:1 while `#1a0e0f` reaches 5.9:1. Any "fix" that makes it
white for consistency is a contrast regression.

Tints are each hue at roughly 12% over the page, so they stay legible without
becoming a second surface colour.
