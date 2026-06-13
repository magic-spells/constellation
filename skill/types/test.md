# TEST cards (`TEST-`, `test/`)

One card per meaningful test spec (a suite or scenario, not every assertion).
The category goes in the reserved `kind`: `unit`, `integration`, `e2e`. Connect
the card to what it covers.

| Field | Type | Notes |
|---|---|---|
| `framework` | string | `vitest`, `jest`, `pytest`, `playwright`, … |

Example — `constellation/test/TEST-CREATE-TICKET.md`:

```markdown
---
name: Create ticket — integration
kind: integration
status: verified
framework: vitest
connections:
  - API-TICKETS
  - FLOW-CREATE-TICKET
---

Covers the full [[FLOW-CREATE-TICKET]] happy path plus the 422 branch:

- valid input → 201, row in [[DB-TICKETS]], event emitted
- missing subject → 422, no row, no event
```
