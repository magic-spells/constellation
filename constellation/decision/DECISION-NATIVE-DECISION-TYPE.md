---
name: DECISION is a native card type
status: built
connections:
  - DOC-CARD-TYPES
  - DOC-MCP-UPGRADES
  - FILE-TYPES
---

# DECISION is a native card type

Reverses the earlier call in [[DOC-MCP-UPGRADES]] ("decided AGAINST a dedicated
`DECISION` card type"). This card is itself the first native decision card — the
new type records the *why*; [[DOC-CARD-TYPES]] records the *what*.

## Context

The original reasoning was that co-location beats a separate filing system:
decisions live as `append_note(kind: decision)` on the cards they concern, or as
a DOC card (`kind: decision`) when bigger. Field use broke that model two ways:

- **Volume.** Real projects accumulated 30+ `DOC-…` decision cards, burying the
  actual documentation (guides, rules) in `doc/` and making "every decision" a
  kind-filter query instead of a folder and a type.
- **Fan-out.** A decision routinely shapes *several* cards, so there is no single
  card to co-locate a note on. The graph already had the right primitive —
  connections — but no node type for the decision itself.

The skill also already mandated one-file-per-decision ("Decisions (ADRs) get one
DOC card each"), so the "separate filing system" existed either way; it was just
typed as documentation.

## Decision

Add `DECISION-` / `decision/` as the 18th type. A DECISION card is an ADR — the
choice, the why, the alternatives rejected — **connected to every card it
shaped**. One structured field, `supersedes` (an earlier DECISION handle; must
resolve, and connects the two). Superseded decisions are kept, never deleted.

`append_note(kind: decision)` stays: it remains the right home for a choice local
to a single card. Promote a note to a DECISION card when the choice touches more
than one card or the rejected alternatives are worth recording.

## Alternatives

- **Status quo (DOC `kind: decision`)** — rejected: pollutes `doc/`, invisible in
  the type system, and retrieval (viewer nav, `list_cards`, `describe_type`)
  can't treat decisions as first-class.
- **Notes only, no decision cards** — rejected: cross-cutting decisions have no
  co-location target; splitting one rationale across N notes drifts.

## Consequences

- `doc/` is documentation again: suggested DOC kinds shrink to guide / rule / meta.
- Adding the type touched the usual four places ([[DOC-CARD-TYPES]]) plus the
  three agent-guidance copies and the viewer palette.
- Existing plans with `DOC-…` decision cards can migrate one card at a time with
  `rename_card` (e.g. `DOC-DECISION-X` → `DECISION-X`); nothing forces it.
