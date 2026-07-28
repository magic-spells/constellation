# DOC cards (`DOC-`, `doc/`)

No structured fields — DOC cards are prose. Suggested `kind`: `guide`, `rule`,
`meta`. DOCs explain *how* the system is set up; the *why* behind a choice is a
[DECISION card](./decision.md), not a DOC.

**Never create index cards** — a DOC that just enumerates other cards
(`DOC-DECISIONS` listing every DECISION card, `DOC-APIS` listing every endpoint,
a table-of-contents card). Those listings are *derived views*: `list_cards`,
`search`, and the viewer already produce them live from the files, and a stored
copy is stale the moment the next card is added. If you find one, delete it.

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
