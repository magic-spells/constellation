# PLAN cards (`PLAN-`, `plan/` — and `plan.md` at the root)

`constellation/plan.md` is the card `PLAN-PROJECT`: the short, living summary of
where the project stands. Scoped plans (`PLAN-FRONTEND`) live in `plan/`.

Keep it **short**. Three rules:

- Decisions go in DOC cards (`kind: decision`), one file each — not in the plan.
- Per-card status lives on the cards (`status:`), not in plan checklists.
- Edit the relevant section; never bulk-rewrite the file (it's shared state).

| Field | Type | Notes |
|---|---|---|
| `scope` | string | area for scoped plans, e.g. `frontend`; omit for `plan.md` |

Example — `constellation/plan.md`:

```markdown
---
name: Project plan
---

# Project Plan

## Current state

- Core ticket loop specced: [[FLOW-CREATE-TICKET]], [[API-TICKETS]], [[DB-TICKETS]]
- Auto-assignment ([[JOB-AUTO-ASSIGN]]) planned, not built

## Conventions

- All ticket payloads use [[DATATYPE-TICKET]]; never inline ticket shapes.

## Last synced

Code last reconciled against plan commit `<sha>` (maintained by the sync agent).
```
