---
name: FEATURE and RELEASE are native card types
status: built
connections:
  - DOC-CARD-TYPES
  - FILE-TYPES
  - DECISION-NATIVE-DECISION-TYPE
verified_sha: d5c77f0d44725ae7ab3236c191caef3c3332016c
verified_at: '2026-08-16T00:47:22.586Z'
section: decisions
order: 20
---

# FEATURE and RELEASE are native card types

## Context

Constellation modeled the *initial* build well — PLAN cards and phases, work
marked `status: planned` — but had no primitive for how projects actually grow
afterwards: feature branches that ship in release versions. `planned` marks
individual cards, yet nothing groups a coherent slice of work; and a version's
intent (theme, upgrade notes) had no home that isn't a changelog.

## Decision

Add two types (the 19th and 20th). **FEATURE** — a coherent unit of future
work, connected to every card it adds or touches; fields `release` (handle of
the RELEASE it targets — structured ref, auto-connects) and `branch`
(informational). **RELEASE** — a version milestone; field `version`. Status
carries each card's arc: a FEATURE goes `planned → building → built` as its
branch merges; a RELEASE goes `planned → built` as it ships.

Two guardrails hold the philosophy:

- **FEATURE is not a ticket tracker.** Work that is one card's status flip
  needs no FEATURE card; the backlog stays a `status` query.
- **RELEASE is not a changelog.** What shipped is git's job ([[DOC-CHANGE-TRACKING]]);
  the card holds only what git can't say — theme, intent, migration notes.

## Alternatives

- **Scoped PLAN cards per feature** — rejected: plans are living summaries, not
  units of work with an arc; and retrieval by type ("show open features") needs
  a prefix.
- **External trackers only (issues/boards)** — rejected: the plan is the
  agent-facing memory; work the graph can't see can't be traversed, assembled,
  or drift-checked.

## Consequences

- The iteration loop is now first-class: feature branch ↔ FEATURE card,
  release version ↔ RELEASE card, wired by `release:`.
- A shipped FEATURE card stays, like a DECISION card
  ([[DECISION-NATIVE-DECISION-TYPE]]) — provenance of why the system grew.
