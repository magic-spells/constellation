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
| `connected_repos` | list | sibling repos this project coordinates with (on `PLAN-PROJECT` only) — see below |

## Connected repos (multi-repo)

When one change spans several sibling repos, declare them on `PLAN-PROJECT` so an agent can
reach each one with the MCP `repo:` selector. These are **repo-level links, not card
connections** — cards never reference another repo's cards, and each plan still lints alone.
Each entry has a lowercase `name` (the `repo:` selector value), a `path` relative to this
repo's root, and a one-line `description`. Paths are local topology — never lint-checked.

```yaml
connected_repos:
  - name: pyramid-server
    path: ../pyramid-server
    description: Back-end API for Pyramid, written in Go.
```

Manage these with `add_connected_repo` / `list_connected_repos` / `remove_connected_repo`
(MCP) or `constellation repos` (CLI), not by hand-editing unless you prefer to.

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
