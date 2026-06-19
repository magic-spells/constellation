---
name: Ticket
status: built
connections:
  - DB-TICKETS
code_refs:
  - src/types/ticket.ts:Ticket
notes:
  - kind: decision
    text: requester_email is denormalized onto the ticket so list views avoid a join.
---

The canonical ticket shape, returned by every ticket endpoint.

```ts
interface Ticket {
  id: string;
  subject: string;
  body: string;
  status: 'open' | 'assigned' | 'resolved' | 'closed';
  requester_email: string;
  assignee_id: string | null;
  created_at: string; // ISO 8601
}
```
