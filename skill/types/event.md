# EVENT cards (`EVENT-`, `event/`)

One card per domain event. `emitter` and `payload_schema` are handles and connect
automatically.

| Field | Type | Notes |
|---|---|---|
| `emitter` | handle | card that emits this event |
| `payload_schema` | handle | DATATYPE of the payload |
| `delivery_semantics` | enum | `at-least-once` \| `at-most-once` \| `exactly-once` |
| `ordering` | enum | `per-aggregate` \| `total` \| `none` |
| `idempotency_key_field` | string | payload field consumers dedupe on |
| `version` | integer | ≥ 1 |

Example — `constellation/event/EVENT-TICKET-CREATED.md`:

```markdown
---
name: Ticket created
status: built
emitter: API-TICKETS
payload_schema: DATATYPE-TICKET
delivery_semantics: at-least-once
ordering: none
idempotency_key_field: id
version: 1
---

Fired after a ticket row is committed. Consumers must dedupe on the ticket `id`.
Currently the only consumer is [[JOB-AUTO-ASSIGN]].
```
