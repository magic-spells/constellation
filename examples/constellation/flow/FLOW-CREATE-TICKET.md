---
name: Create ticket
status: built
triggers:
  - { kind: manual }
---

# Create ticket

1. Requester submits the public ticket form
2. [[API-TICKETS]] POST validates the body against [[DATATYPE-CREATE-TICKET-INPUT]]
   - invalid → 422 with per-field errors
3. Row inserted into [[DB-TICKETS]] with status `open`
4. [[EVENT-TICKET-CREATED]] fires
5. [[JOB-AUTO-ASSIGN]] picks an agent and sends the confirmation email via
   [[EXTERNAL-EMAIL-PROVIDER]]
