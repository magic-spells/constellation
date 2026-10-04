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
  - src/core/no-follow.ts
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
- **Cross-process writes.** Every `working.md` write takes the `working.md.lock/` folder lock (stale after 10 s, single-winner break), re-checks the file is unchanged before the rename (5 retries, then `CONFLICT`), and logs before the rename from the winning attempt only — so hooks firing together log each drop once. Why a lock, and why a folder: [[DECISION-WORKING-MEMORY-FOLDER]].

## Security

Threat model: a cloned malicious repo — anything committed, symlinks and `.constellation/` contents included, is attacker-controlled.

- **Never follow a link.** Every read and write of `.constellation/` (the folder, `working.md`, `log/`, `config.json`, the lock), `.claude/` + `.claude/settings.json` and `.gitignore` is `lstat`-checked and refused with `UNSAFE_PATH` when it is a symlink; appends and reads open with `O_NOFOLLOW` (`src/core/no-follow.ts`). A linked `config.json` is ignored with a warning; defaults apply.
- **A shipped folder is untrusted.** If git tracks anything that resolves to `.constellation/` other than a regular-file `CLAUDE.md`, `workingFolderProblem` returns `UNTRUSTED_WORKING`: the folder is never read into agent context, never cleared, never written. `orient`, `working_list` and the hook return only the reason and the `git rm --cached` fix.
- **Matched by disk identity, not spelling.** The full index (`ls-files -s -z`, `precomposeUnicode=false`) is grouped by path prefix and each prefix `lstat`ed; a prefix with the folder's dev+ino is the folder. That defeats Unicode case-fold and NFD aliases (`.Constellation/`, `.conſtellation/`) on APFS/NTFS.
- **Fail closed.** Inside a git repo any git or filesystem error or timeout refuses the folder; git runs with a sanitized env (no inherited `GIT_*`, no fsmonitor, no hooks). If the check throws, the hook prints a one-line refusal. Paths in hook, CLI and MCP messages go through `showPath`, so control and bidi characters in folder names are escaped.
- **`code_root` is bounded** — an out-of-repo `code_root` makes working memory refuse with `UNSAFE_PATH` ([[FILE-REPOS]]).

## Acceptance

- `tests/working-config.test.ts`, `tests/mcp-working-memory.test.ts`, `tests/working-lock.test.ts`: defaults, answers, disabled server, ignore check and migration, clear per hook `source`, worktree never clears, a clear racing a writer in another process, and a cross-process stress test (8 processes, dying holders, planted stale locks) asserting no overlap.
- `tests/working-safety.test.ts`, `tests/working-hostile.test.ts`, `tests/working-trust-git.test.ts`: symlinked lock / log / folder / `working.md` / `config.json` / `.claude` / `.gitignore`, a tracked `working.md` with a `clear` config, case-folded and NFD aliases, an out-of-repo `code_root`, text-carrying folder names, and a failing git that refuses the folder.
