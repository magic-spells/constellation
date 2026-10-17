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
verified_at: '2026-10-04T22:03:30.324Z'
verified_sha: db754ebc084462684b8c0cd84b790679c3cc6e21
notes:
  - kind: verified
    text: >-
      1.1.0 card review: checked against the code at release/1.1.0 db754eb by three review agents
      (core FILE cards, docs/flows/MCP, viewer); false claims fixed in db754eb.
    sha: db754ebc084462684b8c0cd84b790679c3cc6e21
---

Creates `constellation/` + a starter `plan.md` (PLAN-PROJECT). Used by both CLI `init` and MCP `init_plan` so the two can't drift.

It also stamps `format_review` into `.sync.json` (`stampFormatReview`, no git required — there may be no HEAD yet), and nothing else: a plan born on this version was authored under this version's rules, so it must never be offered the one-time format-upgrade review, but it has reconciled nothing, so it gets no sync point.

`workingClaudeMd` is the template for `.constellation/CLAUDE.md`, the working-set rules that working memory writes locally so an agent without the MCP server still knows the format. It is read at session start and after every compaction, so it stays short; the full guidance lives in the skill's `working-memory.md`.
