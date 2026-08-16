---
name: Agent guidance (three copies)
kind: policy
status: built
code_refs:
  - skill/SKILL.md
  - skill/methodology.md
  - tests/guidance-consistency.test.ts
connections:
  - FILE-MCP-SERVER
  - DOC-MCP-UPGRADES
  - FLOW-SYNC-PLAN
verified_sha: d5c77f0d44725ae7ab3236c191caef3c3332016c
verified_at: '2026-08-16T00:47:22.586Z'
---

# Agent guidance

How AI agents are taught to use Constellation. The guidance lives in **three unshared copies
that must stay consistent**: the MCP `INSTRUCTIONS` string ([[FILE-MCP-SERVER]]) and the skill
(`skill/SKILL.md` + `skill/methodology.md`). None imports another, so any change to how an
agent should use the plan must land in all three.

Each copy has one job. `INSTRUCTIONS` is **always on**, so it is capped at 55 lines — the rules
an agent needs without asking. The constant is fixed; the handshake string it produces is not —
the server appends the one-time format-upgrade paragraph to it at boot when the plan carries no
`format_review` stamp ([[DOC-CHANGE-TRACKING]]), which is why the cap applies to the constant. `SKILL.md` is the **pointer**: the same rules with their
mechanics, deferring type schemas to `describe_type` rather than restating them.
`methodology.md` is the **long pass** — building or auditing a whole plan from a codebase — and
also backs the MCP `bootstrap_plan` / `audit_plan` prompts.

Core stance: treat the plan as **durable, cross-session memory** (read the neighborhood before
changing code; update cards as part of "done"); **all card writes go through the tools**, never
by hand, because hand-edits invent fields the schema doesn't support and feed bad data to the
viewer and every future agent; be **plan-first for behavior changes only** — a new FEATURE, an
API contract, a STATE change ([[FLOW-SYNC-PLAN]]) — while refactors and CSS go straight to code;
act as an **orchestrator** for large work (partition into file-disjoint neighborhoods, one card
per agent, then verify). The bar a card is held to is that **a later agent can change the area
without rediscovering the why, the gotchas, and the contracts**.

Consistency is enforced, not remembered: `tests/guidance-consistency.test.ts` asserts the
canonical sentences appear verbatim in every copy that carries them, that retired claims appear
in none, and that no copy names a tool the server doesn't register. See [[DOC-MCP-UPGRADES]]
for the why.
