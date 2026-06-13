# API cards (`API-`, `api/`)

One card per endpoint path (methods nest inside). Schema references are DATATYPE
handles and connect automatically.

| Field | Type | Notes |
|---|---|---|
| `path` | string | URL pattern, e.g. `/api/v1/tickets/:id` |
| `path_params` | array | `{ name, type?, required?, default?, notes? }` |
| `methods` | object | Keys: `GET POST PUT PATCH DELETE HEAD OPTIONS` |
| `methods.<VERB>.query_params` | array | same param shape |
| `methods.<VERB>.request_schema` | handle | DATATYPE card |
| `methods.<VERB>.response_schema` | handle | DATATYPE card |

Example — `constellation/api/API-TICKETS.md`:

```markdown
---
name: List & create tickets
status: built
path: /api/v1/tickets
methods:
  GET:
    query_params:
      - { name: status, type: string }
    response_schema: DATATYPE-TICKET
  POST:
    request_schema: DATATYPE-CREATE-TICKET-INPUT
    response_schema: DATATYPE-TICKET
connections:
  - DB-TICKETS
---

# Tickets API

GET returns tickets filtered by status. POST is the public intake endpoint and
emits [[EVENT-TICKET-CREATED]] after insert — see [[FLOW-CREATE-TICKET]].
```
