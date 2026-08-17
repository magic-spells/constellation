---
name: scaffold.ts
status: verified
path: src/core/scaffold.ts
language: typescript
summary: Shared init scaffold
connections:
  - FILE-CLI
  - FILE-GIT
  - FILE-MCP-SERVER
verified_at: '2026-08-16T19:03:34.428Z'
verified_sha: b68341fab1d50f297248b83eccc2f936ad6b9234
---

Creates `constellation/` + a starter `plan.md` (PLAN-PROJECT). Used by both CLI `init` and MCP `init_plan` so the two can't drift.

It also stamps `format_review` into `.sync.json` (`stampFormatReview`, no git required — there may be no HEAD yet), and nothing else: a plan born on this version was authored under this version's rules, so it must never be offered the one-time format-upgrade review, but it has reconciled nothing, so it gets no sync point.
