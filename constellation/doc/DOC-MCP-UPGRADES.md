---
name: MCP upgrades & memory model
kind: decision
status: built
---

# MCP upgrades & memory model (decisions)

The rationale behind Constellation's role as **durable, cross-session, cross-agent memory**
for AI agents — the "003" upgrade plan, shipped in v0.2.2 (phases 0–6). This card replaces the
former `docs/003`; it is the ADR for the memory/durability design.

## Why this matters

Every session an agent pays a "discovery tax" — rebuilding a mental model of the code before it
can act. Without a place to bank that understanding it evaporates at session end and the next
agent re-pays it. Constellation's value is that understanding **compounds**. Two failure modes
erode it: **drift** (a card's claim silently diverges from code — a card you can't trust is
worse than none) and **friction** (updating a card is expensive, so agents skip it, which
*causes* drift).

## Principles

- **`built` is a claim that outlives its author** — claims must be re-verifiable, not taken on
  faith. Durability, not distrust (the same reason you keep tests).
- **Card what code can't say** — intent, decisions, current state, gotchas, cross-cutting rules.
  Don't duplicate DDL / signatures / code; link to it (copies drift).
- **Make the honest path the cheap path** — most drift is skipped updates; lower the cost of a
  small correction (`append_note`, `edit_section`) and cards stay true.
- **Purpose belongs in the intro** — the MCP instructions load every session, so framing changes
  agent defaults more than any tool. See [[AGENT-GUIDANCE]].

## Two headline capabilities

**Hand me the delta** — what changed since I last looked: plan-side (`diff_plan`) and code-side
reverse drift (`stale_report`, the core new capability). **Hand me the code behind a card** —
attach the bound file ([[FILE-CODE]]), so an agent starts from intent + current reality in one
call. `assemble` fuses both into a fan-out-ready work package.

## Decisions on record

- **Binding granularity** — FILE-`path:` is the default (zero authoring tax); optional
  `code_refs` add precision (`path` or `path:symbol`) only where drift precision earns its keep.
  Drift is detected at file granularity; the symbol is an informational hint.
- **No-per-card-stamping, reconciled** — `verified_sha` is verification *provenance*, not a
  change flag; the drift verdict stays live and unstored ([[DOC-CHANGE-TRACKING]], [[FILE-SYNC]]).
- **Code attach is same-repo** — cards never bind across repos; reach a sibling's code via the
  `repo` selector ([[DOC-CONNECTED-REPOS]]).
- **Decided AGAINST a dedicated `DECISION` card type** — decisions live as data on the cards
  they concern: an `append_note(kind: decision)`, a DOC card (`kind: decision`, like this one),
  or a DIAGRAM. Co-location beats a separate filing system you have to remember to open.
- **Deferred** — a structured partial-status model (`{built, pending}`); typed `notes` cover most
  of that need for now.
