---
name: Create ticket input
status: built
---

Request body for creating a ticket. Server assigns `id`, `status`, and timestamps —
see [[API-TICKETS]].

```ts
interface CreateTicketInput {
  subject: string;
  body: string;
  requester_email: string;
}
```
