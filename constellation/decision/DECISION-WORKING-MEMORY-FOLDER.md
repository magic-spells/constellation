---
name: Working memory is a dot-folder beside the plan, guaranteed by a hook
status: built
connections:
  - FEATURE-WORKING-MEMORY
  - FILE-MCP-SERVER
  - AGENT-GUIDANCE
---

# Working memory is a dot-folder beside the plan, guaranteed by a hook

## Context

Session state (what is in flight, who holds which worktree, what waits on the user) has
to survive two things the plan does not care about: the MCP process ending on a restart,
a `--resume` or a crash, and a compaction summary written by a model nobody can steer.
It also has to be invisible to everything that reads the plan — the index, lint,
`diff_plan`, the atlas and the viewer — because it is not architecture.

## Decision

A gitignored `.constellation/` folder at the plan's code root, sibling to
`constellation/`, holding `working.md`, `log/YYYY-MM-DD.md` and a committed `CLAUDE.md`
of rules. State lives in files, not in MCP process memory. A `SessionStart` hook
(matchers `startup|resume|compact|clear`) running `constellation working` prints it back
into context; the tools are the ergonomics, the hook is the guarantee. IDs are per type
(`G1`, `C3`, `T12`). Writes go through the existing in-process file lock plus an atomic
temp-and-rename. The folder resolves through `git rev-parse --git-common-dir`, so every
linked worktree shares the main checkout's one scratchpad.

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
- **A `.lock` file** — rejected: one MCP process per session, and sub-agents share its
  connection, so the in-process lock covers every race that matters. Two orchestrators on
  one repo is unsupported, as it already is for cards.
- **Steering the compaction summary** (a `PreCompact` hook, custom instructions) —
  rejected because it cannot be done: `PreCompact` can only block, and blocking
  compaction lets the context grow past the window. The design must not depend on the
  summary at all.

## Consequences

- Working memory is readable and editable by hand, by any agent, with or without the MCP
  server — hence the committed `CLAUDE.md`.
- The history is append-only in `log/`, not in the file; the set stays small enough to
  re-read after every compaction, and past ~25 items it says so.
- `.constellation` joins the code-metrics walk skip list so a FILE card bound to `path: .`
  never counts scratchpad files.
