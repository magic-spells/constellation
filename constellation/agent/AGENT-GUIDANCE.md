---
name: Agent guidance (three copies)
kind: policy
status: built
code_refs:
  - skill/SKILL.md
  - skill/methodology.md
---

# Agent guidance

How AI agents are taught to use Constellation. The guidance lives in **three unshared copies
that must stay consistent**: the MCP `INSTRUCTIONS` string ([[FILE-MCP-SERVER]]) and the skill
(`skill/SKILL.md` + `skill/methodology.md`). None imports another, so any change to how an
agent should use the plan must land in all three.

Core stance: treat the plan as **durable, cross-session memory** (read the neighborhood before
changing code; update cards as part of "done"); be **plan-first** when changing behavior
(express the end state as cards, get sign-off on the plan diff, then bring code up to match —
[[FLOW-SYNC-PLAN]]); act as an **orchestrator** for large work (partition into file-disjoint
neighborhoods, one card per agent, then verify). `skill/methodology.md` also backs the MCP
`bootstrap_plan` / `audit_plan` prompts. See [[DOC-MCP-UPGRADES]] for the why.
