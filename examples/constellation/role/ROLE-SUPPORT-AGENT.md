---
name: Support agent
status: built
permissions:
  - tickets:read
  - tickets:write
  - tickets:assign
issued_by: app
---

A human agent working the inbox. Can read, update, and assign any ticket.
Cannot delete tickets — nothing can; see [[DB-TICKETS]].
