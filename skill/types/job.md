# JOB cards (`JOB-`, `job/`)

One card per background/scheduled/queued task.

| Field | Type | Notes |
|---|---|---|
| `trigger` | enum | `cron` \| `queue` \| `event` \| `manual` |
| `schedule` | string | cron expression when `trigger: cron` |
| `flow` | handle | FLOW this job executes, if any |
| `max_retries` | integer | ≥ 0 |
| `idempotency_key` | string | what makes runs idempotent |

Example — `constellation/job/JOB-AUTO-ASSIGN.md`:

```markdown
---
name: Auto-assign tickets
status: planned
trigger: event
max_retries: 3
connections:
  - EVENT-TICKET-CREATED
---

Listens for [[EVENT-TICKET-CREATED]], picks the agent with the fewest open
tickets, writes the assignment to [[DB-TICKETS]]. Idempotent per ticket `id`.
```
