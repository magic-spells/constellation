# FLOW cards (`FLOW-`, `flow/`)

A FLOW is a linear narrative: numbered steps in the **body**, with nested list
items for error/edge branches. If it genuinely branches, it's a Mermaid flowchart
or actually a STATE card. Steps never go in frontmatter.

| Field | Type | Notes |
|---|---|---|
| `triggers` | array | `{ kind: cron\|event\|manual, schedule?, event? (handle) }` |

Example — `constellation/flow/FLOW-CREATE-TICKET.md`:

```markdown
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
5. [[JOB-AUTO-ASSIGN]] picks an agent
```
