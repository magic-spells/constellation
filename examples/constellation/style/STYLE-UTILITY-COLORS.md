---
name: Utility colors
category: color
status: built
connections:
  - PAGE-INBOX
  - COMPONENT-TICKET-CARD
  - STYLE-COLORS
code_refs:
  - src/styles/tokens.css
tokens:
  - name: success
    value: "#16a34a"
    description: Resolved tickets
  - name: warning
    value: "#d97706"
    description: SLA at risk
  - name: danger
    value: "#dc2626"
    description: Breached SLA, destructive actions
  - name: info
    value: "#0284c7"
    description: Neutral notices — no action needed
---

# Utility colors

The four colours that carry meaning. Status colors map to ticket state
everywhere: the status chip on [[COMPONENT-TICKET-CARD]] reads its colour from
[[STATE-TICKET]], so a resolved ticket is always `success`, never `brand`.

`info` is deliberately blue and deliberately not `brand` — a notice is not a
call to action, and reusing the brand colour for both taught people to ignore
one of them.
