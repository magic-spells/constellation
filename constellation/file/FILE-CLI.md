---
name: cli/index.ts
status: verified
path: src/cli/index.ts
language: typescript
summary: The constellation binary (commander)
connections:
  - FILE-RESOLVE
  - FILE-SERVE
  - FILE-MCP-SERVER
verified_sha: 206a3734a4bc0e73c9806610d88e5311571e17f4
verified_at: '2026-08-18T17:56:52.770Z'
notes:
  - kind: verified
    text: >-
      Re-read against index.ts and skills.ts: the card now documents serve's port walk (EADDRINUSE
      only, 20 tries, banner note), the add-skills multi-select with cancel-vs-empty and the
      --skill-root bypass, and upgrade's --prefer-online.
    sha: b68341fab1d50f297248b83eccc2f936ad6b9234
---

Commands: `init`, `lint`, `rename`, `mcp`, `serve`, `repos`, `add skills`, `version`/`v`, `upgrade`. `lint` exits 1 on errors, 0 otherwise (warnings never fail), 2 when no plan is found. `rename OLD NEW` is the human-facing wrapper over [[FILE-RENAME]] — it prints the rewritten references and a lint-error count.

`serve` **walks upward from a busy port** rather than refusing: up to 20 tries, with the port it landed on printed in the banner so a URL that is not the one you asked for never looks like a typo. Only `EADDRINUSE` advances — `EACCES` on a privileged port means free-but-not-ours, and walking 80→99 would be twenty useless attempts. Serving a second plan, or restarting while a stray process still holds the socket, is ordinary; making the user do the arithmetic was not.

`add skills` (src/cli/skills.ts) installs the packaged authoring skill (`skill/`) into detected agent config dirs (`~/.claude`, `~/.codex`, `~/.cursor`, `~/.agents` → `<root>/skills/constellation`), stamping `.constellation-skill-version` so a later run can tell current from stale. On a TTY it first offers an **arrow/space multi-select** of the detected targets, all checked, so a folder can be deselected instead of written to (the Puzzle CLI's prompt, ported). Cancelling is NOT the same as selecting none — Esc / Ctrl+C / stdin EOF install nothing rather than reading as consent to an empty install. The key handling is a pure reducer (`applySkillPickerKey`) so escape codes and wrap-around are testable without a pty. Symlinked destinations are left alone; stale installs prompt (non-TTY requires `--overwrite`); `--skill-root <dir>` pins targets explicitly AND skips the picker, since naming roots is already the choice the picker asks for.

`upgrade` offers to refresh installed skills after a successful npm upgrade by spawning the NEW binary's `add skills --overwrite`. The npm call passes **`--prefer-online`**: `@latest` is otherwise answerable from a packument cache up to five minutes stale, and the likeliest moment to run `upgrade` is right after hearing a release exists — inside that window. It fails in the worst shape available, succeeding while reinstalling the version you already had.
