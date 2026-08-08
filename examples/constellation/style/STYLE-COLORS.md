---
name: Colors
category: color
status: built
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
  - name: success
    value: "#16a34a"
    description: Resolved tickets
  - name: warning
    value: "#d97706"
    description: SLA at risk
  - name: danger
    value: "#dc2626"
    description: Breached SLA, destructive actions
---

# Colors

Status colors map to ticket state everywhere — a resolved ticket is always
`success`, never brand. Backgrounds stay on `paper`/`brand-soft`.
