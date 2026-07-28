---
name: cli/index.ts
status: built
path: src/cli/index.ts
language: typescript
summary: The constellation binary (commander)
---

Commands: `init`, `lint`, `rename`, `mcp`, `serve`, `repos`, `add skills`, `version`/`v`, `upgrade`. `lint` exits 1 on errors, 0 otherwise (warnings never fail), 2 when no plan is found. `rename OLD NEW` is the human-facing wrapper over [[FILE-RENAME]] — it prints the rewritten references and a lint-error count.

`add skills` (src/cli/skills.ts) installs the packaged authoring skill (`skill/`) into detected agent config dirs (`~/.claude`, `~/.codex`, `~/.cursor`, `~/.agents` → `<root>/skills/constellation`), stamping `.constellation-skill-version` so a later run can tell current from stale. Symlinked destinations are left alone; stale installs prompt (non-TTY requires `--overwrite`); `--skill-root <dir>` pins targets explicitly. `upgrade` offers to refresh installed skills after a successful npm upgrade by spawning the NEW binary's `add skills --overwrite`.
