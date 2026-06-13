# DIAGRAM cards (`DIAGRAM-`, `diagram/`)

Architecture diagrams, three tiers — always prefer the cheapest that works:

1. **Don't author at all**: node neighborhoods can be rendered from the real
   connection graph on demand. Only author a diagram for *conceptual* views.
2. **Mermaid in the body** (the default): use **handles as Mermaid node IDs** so
   the diagram joins the graph automatically.
3. **Pinned layout** (rare): structured `nodes`/`edges`/`phases` frontmatter with
   explicit positions — see `schemas/diagram.json`. Only when layout carries meaning;
   positions make noisy diffs.

Example — `constellation/diagram/DIAGRAM-SYSTEM-OVERVIEW.md`:

````markdown
---
name: System overview
status: built
---

# System overview

```mermaid
flowchart LR
  PAGE-INBOX --> API-TICKETS
  API-TICKETS --> DB-TICKETS
  API-TICKETS --> EVENT-TICKET-CREATED
  EVENT-TICKET-CREATED --> JOB-AUTO-ASSIGN
```

Intake is synchronous down the left edge; everything after the event is async.
````
