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
verified_at: '2026-08-24T21:12:51.545Z'
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
---

Creates `constellation/` + a starter `plan.md` (PLAN-PROJECT). Used by both CLI `init` and MCP `init_plan` so the two can't drift.

It also stamps `format_review` into `.sync.json` (`stampFormatReview`, no git required — there may be no HEAD yet), and nothing else: a plan born on this version was authored under this version's rules, so it must never be offered the one-time format-upgrade review, but it has reconciled nothing, so it gets no sync point.
