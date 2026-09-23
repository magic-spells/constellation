---
name: v1.0.2 — working memory without a plan
status: built
version: 1.0.2
connections:
  - RELEASE-V1-0-1
  - FEATURE-WORKING-MEMORY
  - DECISION-WORKING-MEMORY-FOLDER
  - FILE-MCP-SERVER
  - DOC-MCP-SERVER
  - AGENT-GUIDANCE
---

Theme: working memory no longer needs a plan.

An agent in a plain site repo couldn't keep working memory: every `working_*` tool and both `constellation working` commands stopped with "no constellation folder found". Working memory never reads a card — it only borrowed the plan's location as its anchor — so the requirement was an accident, not a design.

## Upgrade notes

Patch. No change for repos that have a plan.

- **No plan, inside git:** `.constellation/` anchors at the main checkout's git root, so linked worktrees still share one folder. `.gitignore` and `.claude/settings.json` land in the calling checkout.
- **No plan, no git:** reads return "no working memory" quietly and the SessionStart hook prints nothing. `working_init` / `install-hook` refuse with `NO_WORKING_ROOT` (CLI exit 2) instead of guessing a folder.
- **Outside git the lookup never climbs** — only an exact plan at the start dir counts, and only a `constellation/` directory holding `plan.md`. Before, a non-git dir could adopt a parent folder's plan and write a hook into an unrelated repo.
- **`repo:` on the working tools** accepts a path to a repo with no plan.
- **`orient`** still returns `NO_PLAN_FOUND` without a plan; the working set comes from the hook or `working_list`.
- **Guidance:** all three copies say working memory needs no plan — never call `init_plan` just to get it.
- **`/working`** now shows its fallback line when there is nothing to print.

Upgrade the global `constellation` install too: the hook runs it via `npx --no-install`, so an older global never sees the no-plan fallback.
