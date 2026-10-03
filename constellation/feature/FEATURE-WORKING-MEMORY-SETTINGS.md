---
name: Working memory settings and the .constellation/ ignore rule
status: built
release: RELEASE-V1-1-0
change: feature
branch: feat/working-config
pr: '#44'
code_refs:
  - src/core/working-config.ts
  - src/core/working-lock.ts
  - src/core/working.ts
  - src/cli/hook-input.ts
connections:
  - FEATURE-WORKING-MEMORY
  - DECISION-WORKING-MEMORY-FOLDER
  - FILE-MCP-SERVER
  - FILE-CLI
  - FILE-SCAFFOLD
  - FILE-WRITER
  - DOC-MCP-SERVER
  - AGENT-GUIDANCE
---


Per-repo working memory settings the user chooses once, an optional clear at each new session, and a `.constellation/` ignore rule that is checked rather than assumed.

The user's rules, verbatim: "constellation/ folder is in the repo - long term planning" / ".constellation/ folder is local, conversational memory, not tracked" / "the agent should make sure to add .constellation to the gitignore file when it first inits the constellation project".

## Scope

- **`.constellation/config.json`** — `{ working: { enabled, new_session: keep|clear } }`, local like the rest of the folder. Missing file or key = `enabled: true, new_session: keep` (1.0 behaviour); malformed = defaults plus a warning.
- **Asked once.** At first setup the agent asks "use working memory on this repo?" and "clear it every new session?" and passes the answers: `working_init { enabled, new_session }` or `init_plan { working_enabled, new_session }`. Written only when no config exists; unanswered means defaults reported in `defaults_applied` and nothing saved, so the question stays open. `init_plan { working: false }` still means skip. CLI `init` / `working install-hook` prompt on a TTY or take `--working` / `--no-working` / `--new-session`.
- **The settings are the user's.** Agents never change them; the user runs `constellation working on|off`, `working new-session keep|clear`, `working config`.
- **`enabled: false`:** the `working_*` tools are removed before the handshake and the instructions drop the working-memory paragraph; `orient` omits `working`; the hook prints nothing; a `repo:` call into a disabled repo fails `WORKING_DISABLED`.
- **`new_session: clear`:** on SessionStart `startup` or `clear`, `constellation working` drops every non-CONSTRAINT item and logs each drop. Never on `compact` or `resume`, never from a linked worktree — the list is shared repo-wide, so clear suits one session at a time. Hook stdin is read only in clear mode, off a TTY, with a 300 ms timeout.
- **Ignore rule.** One `.constellation/` line covers the whole folder, `CLAUDE.md` included. `init`, `init_plan` (even with `working: false`), `working_init` and `install-hook` verify it with `git check-ignore --no-index`, move our line to the end if a later rule un-ignores it, and report `gitignore_check: ok|fixed|failed|skipped`. The 1.0 pair (`.constellation/*` + `!.constellation/CLAUDE.md`) is migrated in place. Already-tracked files are warned about with the `git rm --cached -r .constellation` command, never untracked for the user; `orient` and `working_list` flag them too.
- **Cross-process writes.** Every `working.md` write takes `working.md.lock` (stale after 10 s), re-checks the file is unchanged before the rename (5 retries, then `CONFLICT`), and logs before the rename from the winning attempt only — so hooks firing together log each drop once. Why a lock now: [[DECISION-WORKING-MEMORY-FOLDER]].

## Acceptance

- `tests/working-config.test.ts`, `tests/mcp-working-memory.test.ts`, `tests/working-lock.test.ts`: defaults, answers, disabled server, ignore check and migration, clear per hook `source`, worktree never clears, a clear racing a writer in another process.
