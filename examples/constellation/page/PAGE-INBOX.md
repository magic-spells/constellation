---
name: Inbox
status: building
route: /inbox/:ticket_id?
path_params:
  - { name: ticket_id, type: string, required: false }
query_params:
  - { name: status, type: string }
connections:
  - API-TICKETS
  - COMPONENT-TICKET-CARD
  - ROLE-SUPPORT-AGENT
---

# Inbox

The agent-facing ticket list. Loads tickets from [[API-TICKETS]] and renders each
as a [[COMPONENT-TICKET-CARD]]. Selecting a ticket opens it inline (the optional
`ticket_id` path param).
