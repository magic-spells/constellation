# DATATYPE cards (`DATATYPE-`, `datatype/`)

No structured fields. The type declaration lives in the body as a fenced code
block (` ```ts `, ` ```sql `, …) — readable, diffable, and copy-pasteable into code.

Example — `constellation/datatype/DATATYPE-TICKET.md`:

````markdown
---
name: Ticket
status: built
connections:
  - DB-TICKETS
---

The canonical ticket shape, returned by every ticket endpoint.

```ts
interface Ticket {
  id: string;
  subject: string;
  status: 'open' | 'assigned' | 'resolved' | 'closed';
  created_at: string; // ISO 8601
}
```
````
