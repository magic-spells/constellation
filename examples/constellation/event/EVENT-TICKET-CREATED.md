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

Fired after a ticket row is committed. Consumers must dedupe on the ticket `id`
— delivery is at-least-once. Currently the only consumer is [[JOB-AUTO-ASSIGN]].
