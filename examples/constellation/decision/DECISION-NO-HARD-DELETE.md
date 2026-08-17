---
name: Tickets are never hard-deleted
status: built
section: overview
order: 30
connections:
  - DB-TICKETS
  - STATE-TICKET
  - API-TICKETS
---

# Tickets are never hard-deleted

## Context

Support history is evidence: agents cite past tickets in disputes, and
[[JOB-AUTO-ASSIGN]] scores assignees on historical volume.

## Decision

Rows in [[DB-TICKETS]] are never deleted. "Deleting" a ticket moves it to
`closed` in [[STATE-TICKET]]; [[API-TICKETS]] exposes no DELETE.

## Alternatives

- **Hard delete with an audit table** — rejected: two sources of truth, and the
  audit copy drifts from the live schema.
- **Soft-delete flag (`deleted_at`)** — rejected: every query must remember to
  filter it; `closed` already expresses "out of the working set."

## Consequences

- Table growth is unbounded; revisit archiving if it becomes a problem.
- Requester PII lives on in closed tickets — retention policy must handle it.
