---
name: Auto-assign tickets
status: planned
trigger: event
max_retries: 3
connections:
  - EVENT-TICKET-CREATED
---

# Auto-assign

Listens for [[EVENT-TICKET-CREATED]], picks the support agent with the fewest
open tickets, writes the assignment to [[DB-TICKETS]], and sends the requester a
confirmation email through [[EXTERNAL-EMAIL-PROVIDER]]. Idempotent per ticket `id` —
re-delivery must not reassign.
