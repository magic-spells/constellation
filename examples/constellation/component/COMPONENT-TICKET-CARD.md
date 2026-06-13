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

# Ticket card

One ticket in the inbox list: subject, requester, status chip, age. The status
chip colors follow [[STATE-TICKET]].
