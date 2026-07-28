# DECISION cards (`DECISION-`, `decision/`)

One card per architecture decision **topic** — a living record of the *current*
choice, the *why*, and the alternatives rejected. Docs explain how the system is
set up; a DECISION explains why it came to be that way. Connect the card to
**every card the decision shaped** — that's the point of making decisions graph
nodes: reading any affected card surfaces the reasoning behind it.

**When a decision changes, update the existing card — never create a new one.**
Rewrite the body so it states only the latest decision and why; the abandoned
approach moves into **Alternatives** as a rejected option ("we tried this;
here's why we moved off it") — usually a line or two, not a chronicle. Compact
as you go: a reader should get the current decision and its reasoning, not a
reconciliation exercise across revisions. Git history holds the full trail;
the card holds the present. A chain of superseding DECISION cards about the
same topic is an anti-pattern — if you find one, merge it into one card.

Scope rule: a choice local to a single card is an `append_note(kind: decision)`
on that card, not a DECISION card. Promote it to a DECISION card when it touches
more than one card or was genuinely debated (alternatives worth recording).

`status` reads naturally: `planned` = proposed, `built` = adopted/in effect,
`verified` = re-checked against the code. A decision that stops applying
entirely (the feature it governed is gone) can simply be deleted.

Body sections (suggested, not enforced): **Context** (the forces), **Decision**
(what was chosen), **Alternatives** (what was rejected and why — including
previously adopted approaches since replaced), **Consequences** (what follows).

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
- **Soft-delete flag (`deleted_at`)** — we shipped this first, then removed it:
  every query had to remember to filter it, and `closed` already expresses
  "out of the working set."

## Consequences

- Table growth is unbounded; revisit archiving if it becomes a problem.
- Requester PII lives in closed tickets — retention policy must handle it.
```
