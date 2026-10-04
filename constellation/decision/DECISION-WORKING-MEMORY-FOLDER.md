---
name: Working memory is a dot-folder beside the plan, guaranteed by a hook
status: built
connections:
  - FEATURE-WORKING-MEMORY
  - FILE-MCP-SERVER
  - AGENT-GUIDANCE
notes:
  - kind: decision
    text: >-
      Pruning has named checkpoints (1.1.0): every commit, every PR opened or merged, a change of
      topic, and the start of a new plan or feature — sweep first (drop what fails its keep test),
      then add the new items. Why: in long sessions agents only ever added, so the set filled with
      lines about work that had already landed. "Whenever you close work" was too vague a trigger.
      The guidance now names the add-only bias outright, in all three copies plus the
      .constellation/CLAUDE.md template and the working_drop description. Rejected for now: a
      PostToolUse hook on git commit / gh pr and auto-flagging merged TASK lines — wording first,
      mechanical nudges if it isn't enough.
---

# Working memory is a dot-folder beside the plan, guaranteed by a hook

## Context

Session state (what is in flight, who holds which worktree, what waits on the user) has
to survive two things the plan does not care about: the MCP process ending on a restart,
a `--resume` or a crash, and a compaction summary written by a model nobody can steer.
It also has to be invisible to everything that reads the plan — the index, lint,
`diff_plan`, the atlas and the viewer — because it is not architecture.

## Decision

A `.constellation/` folder at the plan's code root, sibling to `constellation/`, holding
`working.md`, `log/YYYY-MM-DD.md`, a `CLAUDE.md` of rules and the user's `config.json`
([[FEATURE-WORKING-MEMORY-SETTINGS]]). **The whole folder is local and untracked** — one
`.constellation/` line in `.gitignore`, verified with `git check-ignore`: `constellation/` is
long-term planning in the repo, `.constellation/` is conversational memory. With no plan it
sits at the git root (working memory never reads a card); outside git with no plan there is
no anchor — reads are quiet, `working_init` / `install-hook` refuse (`NO_WORKING_ROOT`).
State lives in files, not MCP process memory. A `SessionStart` hook (matchers
`startup|resume|compact|clear`) running `constellation working` prints it back into
context; the tools are the ergonomics, the hook is the guarantee. IDs are per type (`G1`,
`C3`, `T12`). Every `working.md` write takes a cross-process lock, re-checks the file is
unchanged before an atomic temp-and-rename, and logs before the rename. The lock is a folder,
`working.md.lock/`, holding one `<16-hex token>.json`, taken by renaming a temp folder into
place; release and stale-break each unlink one exact token record, then `rmdir`. Tokens are
never reused, so a late breaker gets `ENOENT` and can never free a successor's lock — exactly
one winner. The folder resolves through `git rev-parse --git-common-dir`, so linked worktrees
share one scratchpad.

## Alternatives

- **`.orbit/`** (where this started, by hand) — rejected: this is a Constellation
  feature, and borrowing a second product's folder name invites a collision if that
  product ever writes its own.
- **Under `constellation/`** — rejected: only two non-card files may sit in a plan folder
  (`.sync.json`, `atlas.json`), and a scratchpad is neither authored placement nor
  provenance. Beside it, dotted, makes "not the plan" obvious and every existing walk
  already skips dot-dirs.
- **In-process MCP memory** — rejected: it dies with the server and Codex/Grok agents
  never see it. Expiry is the keep test and `working_drop`, not a process lifetime.
- **`W<n>` ids** — rejected: `T12` says what it is without reading the section header.
- **A status field (`active|paused|done`)** — rejected: done items are noise on every
  re-read. An item is in the file or it is dropped, and the reason goes to the log.
- **The in-process lock alone** — 1.0's choice, dropped in 1.1.0: the automatic clear at
  session start made a hook process writing beside the MCP server routine, not an edge case.
- **A committed `CLAUDE.md`** (1.0's `.constellation/*` + `!.constellation/CLAUDE.md`) —
  dropped in 1.1.0 on the user's rule: ".constellation/ folder is local, conversational
  memory, not tracked". `working_init` / `install-hook` migrate the old pair in place.
- **Steering the compaction summary** (a `PreCompact` hook, custom instructions) —
  rejected because it cannot be done: `PreCompact` can only block, and blocking
  compaction lets the context grow past the window. The design must not depend on the
  summary at all.

## Consequences

- Working memory is readable and editable by hand, by any agent, with or without the MCP
  server — hence the local `CLAUDE.md` of rules, written by `working_init`. A fresh clone
  has none.
- The history is append-only in `log/`, not in the file; the set stays small enough to
  re-read after every compaction, and past ~25 items it says so.
- `.constellation` joins the code-metrics walk skip list so a FILE card bound to `path: .`
  never counts scratchpad files.
