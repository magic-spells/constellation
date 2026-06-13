# DB cards (`DB-`, `db/`)

One card per table/collection. Suggested `kind`: `sql-table`, `document-collection`,
`kv`, `time-series`, `graph`.

| Field | Type | Notes |
|---|---|---|
| `table_name` | string | physical name |
| `columns` | array | `{ name, sql_type?, primary_key?, not_null?, unique?, default? }` |
| `indexes` | array | `{ name?, columns?, unique? }` |
| `foreign_keys` | array | `{ columns?, references_table?, references_columns?, on_delete? }` |

Example — `constellation/db/DB-TICKETS.md`:

```markdown
---
name: tickets table
kind: sql-table
status: built
table_name: tickets
columns:
  - { name: id, sql_type: UUID, primary_key: true, default: gen_random_uuid() }
  - { name: subject, sql_type: TEXT, not_null: true }
  - { name: status, sql_type: TEXT, not_null: true, default: "'open'" }
indexes:
  - { name: tickets_status_idx, columns: [status] }
connections:
  - DATATYPE-TICKET
---

One row per ticket. `status` values mirror [[STATE-TICKET]]; rows are never
deleted, only moved to `closed`.
```
