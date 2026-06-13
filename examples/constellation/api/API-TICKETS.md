---
name: List & create tickets
status: built
path: /api/v1/tickets
methods:
  GET:
    query_params:
      - { name: status, type: string }
      - { name: assignee_id, type: string }
    response_schema: DATATYPE-TICKET
  POST:
    request_schema: DATATYPE-CREATE-TICKET-INPUT
    response_schema: DATATYPE-TICKET
connections:
  - DB-TICKETS
  - ROLE-SUPPORT-AGENT
---

# Tickets API

GET returns tickets filtered by status and assignee; requires
[[ROLE-SUPPORT-AGENT]]. POST is the public intake endpoint (no auth) and emits
[[EVENT-TICKET-CREATED]] after insert — see [[FLOW-CREATE-TICKET]] for the full
sequence.
