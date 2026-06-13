# DOC cards (`DOC-`, `doc/`)

No structured fields — DOC cards are prose. Suggested `kind`: `guide`, `rule`,
`decision`, `meta`. Decisions (ADRs) get one DOC card each (`kind: decision`),
never a section in `plan.md`.

Example — `constellation/doc/DOC-TICKET-LIFECYCLE.md`:

```markdown
---
name: How tickets move through the system
kind: guide
status: built
---

# Ticket lifecycle

A ticket is born when the public form posts to [[API-TICKETS]] — the whole
sequence is [[FLOW-CREATE-TICKET]]. From there it walks [[STATE-TICKET]].

Invariant the code must never break: state transitions happen only in the API
layer. Nothing writes the `status` column directly.
```
