---
name: Ticket lifecycle
status: built
states:
  - { name: open, initial: true }
  - { name: assigned }
  - { name: resolved }
  - { name: closed, terminal: true }
transitions:
  - { from: open, to: assigned, action: notify assignee }
  - { from: assigned, to: resolved }
  - { from: resolved, to: assigned, guard: requester reopens }
  - { from: resolved, to: closed, guard: requester confirms or 7 days pass }
connections:
  - DB-TICKETS
---

# Ticket lifecycle

```mermaid
stateDiagram-v2
  [*] --> open
  open --> assigned: agent assigned
  assigned --> resolved: agent resolves
  resolved --> assigned: requester reopens
  resolved --> closed: confirmed / 7 days
  closed --> [*]
```

The `status` column in the tickets table holds the current state; transitions are
enforced in the API layer, never by direct column updates.
