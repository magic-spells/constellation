# FEATURE cards (`FEATURE-`, `feature/`)

One card per coherent unit of *future* work — the iteration primitive once a
project is past its initial build. PLAN cards and phases carry the first build;
after that, work arrives as features on branches. A FEATURE card groups that
slice: connect it to **every card the feature adds or touches**, so the graph
answers "what does shipping this involve" in one hop.

Scope rule: this is not a ticket tracker. Work small enough to be one card's
status flip needs no FEATURE card — just flip the status. Reach for a FEATURE
when the work spans several cards or needs intent/acceptance recorded.

| Field | Type | Notes |
|---|---|---|
| `release` | handle | `RELEASE-` card this feature targets or shipped in; must resolve, and connects the two |
| `branch` | string | git branch it's developed on (informational — the card outlives the branch) |
| `pr` | string | link to the PR (or commit) that shipped it — a URL or `#42`; set when it merges |

`status` is the feature's arc: `planned` = specced, not started; `building` = in
progress on its branch; `built` = merged (set `pr:` then, as provenance);
`verified` = confirmed in a release.
A shipped FEATURE card stays — it's the record of why the system grew, alongside
any [DECISION cards](./decision.md) it produced.

Body: intent (the problem), scope (in/out), acceptance (how you know it's done),
with `[[links]]` to the cards involved.

Example — `constellation/feature/FEATURE-AUTO-ASSIGNMENT.md`:

```markdown
---
name: Auto-assignment of new tickets
status: planned
release: RELEASE-V1-1-0
branch: feature/auto-assign
connections:
  - JOB-AUTO-ASSIGN
---

# Auto-assignment of new tickets

New tickets sit unassigned until a human triages them; median first-response
time suffers. Ship [[JOB-AUTO-ASSIGN]] so every ticket created via
[[API-TICKETS]] gets an assignee within a minute.

## Scope

- In: assignment job, round-robin scoring over open ticket counts in [[DB-TICKETS]].
- Out: skill-based routing; reassignment of already-open tickets.

## Acceptance

- A ticket created while at least one agent is active is assigned in < 60s.
- Assignment respects [[STATE-TICKET]] — only `open` tickets are eligible.
```
