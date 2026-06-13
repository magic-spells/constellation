# FILE cards (`FILE-`, `file/`)

Reference from the plan to a real source file. `path` is the only required field
in the entire format. Create FILE cards for load-bearing files (entry points,
route tables, core modules) — not for every file in the repo.

| Field | Type | Notes |
|---|---|---|
| `path` | string | **required** — relative to repo root |
| `language` | string | `typescript`, `python`, … |
| `summary` | string | one line |

Example — `constellation/file/FILE-TICKETS-ROUTE.md`:

```markdown
---
name: tickets route handler
status: built
path: src/api/tickets.ts
language: typescript
summary: Express route handlers for the tickets API
connections:
  - API-TICKETS
---

Implements [[API-TICKETS]]. Validation lives here; persistence is in the
repository module it imports.
```
