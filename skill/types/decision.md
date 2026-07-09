# DECISION cards (`DECISION-`, `decision/`)

One card per architecture decision (ADR): the choice, the *why*, and the
alternatives rejected. Docs explain how the system is set up; a DECISION explains
why it came to be that way. Connect the card to **every card the decision
shaped** — that's the point of making decisions graph nodes: reading any affected
card surfaces the reasoning behind it.

Scope rule: a choice local to a single card is an `append_note(kind: decision)`
on that card, not a DECISION card. Promote it to a DECISION card when it touches
more than one card or was genuinely debated (alternatives worth recording).

| Field | Type | Notes |
|---|---|---|
| `supersedes` | handle | earlier `DECISION-` card this one replaces; must resolve, and connects the two |

`status` reads naturally: `planned` = proposed, `built` = adopted/in effect,
`verified` = re-checked against the code. Never delete a superseded decision —
the successor points at it via `supersedes`; history is the point.

Body sections (suggested, not enforced): **Context** (the forces), **Decision**
(what was chosen), **Alternatives** (what was rejected and why), **Consequences**
(what follows).

Example — `constellation/decision/DECISION-NO-HARD-DELETE.md`:

```markdown
---
name: Tickets are never hard-deleted
status: built
connections:
  - DB-TICKETS
  - STATE-TICKET
---

# Tickets are never hard-deleted

## Context

Support history is evidence: agents cite past tickets in disputes, and
[[JOB-AUTO-ASSIGN]] scores assignees on historical volume.

## Decision

Rows in [[DB-TICKETS]] are never deleted. "Deleting" a ticket moves it to
`closed` in [[STATE-TICKET]]; the API exposes no DELETE.

## Alternatives

- **Hard delete with an audit table** — rejected: two sources of truth, and the
  audit copy drifts from the live schema.
- **Soft-delete flag (`deleted_at`)** — rejected: every query must remember to
  filter it; `closed` already expresses "out of the working set."

## Consequences

- Table growth is unbounded; revisit archiving if it becomes a problem.
- Requester PII lives in closed tickets — retention policy must handle it.
```
