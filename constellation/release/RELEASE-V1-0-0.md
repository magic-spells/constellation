---
name: v1.0.0 — working memory
status: building
version: 1.0.0
connections:
  - FEATURE-WORKING-MEMORY
  - DECISION-WORKING-MEMORY-FOLDER
  - DOC-MCP-SERVER
  - AGENT-GUIDANCE
---

Theme: the plan gets a scratchpad.

Cards are durable, cross-session memory. This release adds the short-term kind: what is in flight, in which worktree, held by which agent, what waits on the user, what was decided tonight. It lives in a gitignored `.constellation/` beside the plan ([[DECISION-WORKING-MEMORY-FOLDER]]), is edited by the `working_*` tools and embedded in `orient`, and is re-printed into context after every compaction by a SessionStart hook, so an orchestrator running with a small compaction window never loses track of the stretch ([[FEATURE-WORKING-MEMORY]]). A user-invocable `/working` skill shows or edits the set from the chat. The authoring skill gains the rules: one question per type, keep tests, done means dropped, short lines, and items inferred from the conversation rather than dictated.

1.0.0 because the two halves of memory are now both here: the plan for what the system is, working memory for what we are doing about it.

## Upgrade notes

Additive. Nothing to migrate.

- **`init_plan` creates `.constellation/` by default** (`working: false` to skip). Existing plans get it with `working_init`, which also appends two `.gitignore` lines. The hook is opt-in: `working_init { hook: true }` or `constellation working install-hook`.
- **`orient` gains `working`** only when the folder exists; every other field is unchanged.
- **`add skills` installs two payloads**: the authoring skill and the `/working` command skill beside it. Re-run it after upgrading.
- **New CLI subcommand** `constellation working [install-hook]`.
- Nothing in `.constellation/` reaches the index, lint, viewer, `diff_plan` or `check_sync`.
