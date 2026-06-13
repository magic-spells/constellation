# AGENT cards (`AGENT-`, `agent/`)

AI agent instructions/policies — the plan-level equivalent of a scoped CLAUDE.md.
The instruction text is the body.

| Field | Type | Notes |
|---|---|---|
| `scope` | string | glob/directory the rules apply to |
| `applies_to` | string | `all-agents` or a specific role |
| `priority` | integer | higher loads first |

Example — `constellation/agent/AGENT-CODE-STYLE.md`:

```markdown
---
name: Code style rules
status: built
scope: src/**
applies_to: all-agents
priority: 1
---

- TypeScript strict mode; no `any` without a comment explaining why.
- Route handlers validate input with the shapes from [[DATATYPE-TICKET]] —
  never hand-rolled checks.
```
