# ROLE cards (`ROLE-`, `role/`)

One card per role or permission group.

| Field | Type | Notes |
|---|---|---|
| `permissions` | string[] | conventionally `resource:action` |
| `issued_by` | string | `app`, `org`, `tenant`, `os`, … |

Example — `constellation/role/ROLE-SUPPORT-AGENT.md`:

```markdown
---
name: Support agent
status: built
permissions:
  - tickets:read
  - tickets:write
  - tickets:assign
issued_by: app
---

A human agent working the inbox. Cannot delete tickets — nothing can; see
[[DB-TICKETS]].
```
