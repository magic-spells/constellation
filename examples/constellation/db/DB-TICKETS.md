---
name: tickets table
kind: sql-table
status: built
table_name: tickets
columns:
  - { name: id, sql_type: UUID, primary_key: true, default: gen_random_uuid() }
  - { name: subject, sql_type: TEXT, not_null: true }
  - { name: body, sql_type: TEXT, not_null: true }
  - { name: status, sql_type: TEXT, not_null: true, default: "'open'" }
  - { name: requester_email, sql_type: TEXT, not_null: true }
  - { name: assignee_id, sql_type: UUID }
  - { name: created_at, sql_type: TIMESTAMPTZ, not_null: true, default: now() }
indexes:
  - { name: tickets_status_idx, columns: [status] }
connections:
  - DATATYPE-TICKET
---

One row per ticket. `status` values mirror [[STATE-TICKET]]; rows are never
deleted, only moved to `closed`.
