# COMPONENT cards (`COMPONENT-`, `component/`)

One card per reusable UI component. Prop types may be handles
(`type: DATATYPE-TICKET`) — those connect automatically.

| Field | Type | Notes |
|---|---|---|
| `framework` | string | `svelte`, `react`, `web-component`, … |
| `props` | array | `{ name, type?, required? }` |
| `slots` | array | `{ name, accepts? }` |
| `variants` | string[] | |

Example — `constellation/component/COMPONENT-TICKET-CARD.md`:

```markdown
---
name: Ticket card
status: building
framework: svelte
props:
  - { name: ticket, type: DATATYPE-TICKET, required: true }
  - { name: selected, type: boolean }
variants: [default, compact]
connections:
  - PAGE-INBOX
---

One ticket in the inbox list: subject, requester, status chip, age. The status
chip colors follow [[STATE-TICKET]].
```
