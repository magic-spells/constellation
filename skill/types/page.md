# PAGE cards (`PAGE-`, `page/`)

One card per route/screen. Route fields are flat (no nested `route` object).

| Field | Type | Notes |
|---|---|---|
| `route` | string | URL pattern, e.g. `/inbox/:ticket_id?` |
| `parent` | handle | parent PAGE (layout/shell) this nests under |
| `path_params` | array | `{ name, type?, required? }` |
| `query_params` | array | same shape |

Example — `constellation/page/PAGE-INBOX.md`:

```markdown
---
name: Inbox
status: building
route: /inbox/:ticket_id?
path_params:
  - { name: ticket_id, type: string, required: false }
connections:
  - API-TICKETS
  - COMPONENT-TICKET-CARD
---

The agent-facing ticket list. Loads tickets from [[API-TICKETS]] and renders each
as a [[COMPONENT-TICKET-CARD]].
```
