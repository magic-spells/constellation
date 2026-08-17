---
name: Colors
category: color
status: built
connections:
  - PAGE-INBOX
  - COMPONENT-TICKET-CARD
  - STYLE-UTILITY-COLORS
code_refs:
  - src/styles/tokens.css
tokens:
  - name: ink
    value: "#111827"
    description: Primary text
  - name: paper
    value: "#ffffff"
    description: Page background
  - name: brand
    value: "#4f46e5"
    description: Primary actions and links
  - name: brand-soft
    value: "#eef2ff"
    description: Selected rows, subtle highlights
---

# Colors

The base palette: text, background, and the one brand colour everything
interactive is built from. Backgrounds stay on `paper`/`brand-soft` — a tinted
surface is the only way to mark a row, never a border colour.

State lives in [[STYLE-UTILITY-COLORS]] instead, so nothing here has to carry a
meaning: `brand` is what you click, not what something *is*.
