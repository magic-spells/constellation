---
name: Auto-assignment of new tickets
status: planned
release: RELEASE-V1-1-0
branch: feature/auto-assign
connections:
  - JOB-AUTO-ASSIGN
---

# Auto-assignment of new tickets

New tickets sit unassigned until a human triages them; median first-response
time suffers. Ship [[JOB-AUTO-ASSIGN]] so every ticket created via
[[API-TICKETS]] gets an assignee within a minute.

## Scope

- In: assignment job, round-robin scoring over open ticket counts in [[DB-TICKETS]].
- Out: skill-based routing; reassignment of already-open tickets.

## Acceptance

- A ticket created while at least one agent is active is assigned in < 60s.
- Assignment respects [[STATE-TICKET]] — only `open` tickets are eligible.
