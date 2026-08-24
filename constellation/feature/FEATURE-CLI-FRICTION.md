---
name: 'CLI friction: port walk, fresh registry, skill picker'
status: verified
release: RELEASE-V0-5-2
change: fix
branch: fix/serve-port-and-upgrade
connections:
  - FILE-CLI
  - FILE-SERVE
verified_at: '2026-08-24T21:11:21.273Z'
verified_sha: fd006635cd65d9ffc79ddd45e8484c4ff9a18511
notes:
  - kind: verified
    text: >-
      Port walk exercised live: two servers on 4747 and 4748, both answering 200, the second
      printing "4747 was in use, using 4748". --skill-root verified to bypass the picker and stamp
      0.5.1. upgrade's --prefer-online confirmed against the timing that caused the report (0.5.1
      published 18:45:06Z, upgrade run inside npm's 5-minute packument cache window).
    sha: b68341fab1d50f297248b83eccc2f936ad6b9234
---

Three papercuts reported within an hour of 0.5.1 shipping. Each one had the CLI
stopping to explain itself where it could have done the obvious thing.

## Port walk

`serve` exited 2 on a busy port. Serving a second plan, or restarting while a
stray process still holds the socket, is ordinary — so it walks upward instead
(20 tries) and prints the port it landed on.

Only `EADDRINUSE` advances. `EACCES` on a privileged port is free-but-not-ours,
and walking 80→99 would be twenty useless attempts before the same failure.

## Fresh registry read on upgrade

`upgrade` ran `npm install -g <pkg>@latest`, which npm may answer from a
packument cache up to five minutes stale. The likeliest moment anyone runs
`upgrade` is right after hearing a release exists — squarely inside that window.

It failed in the worst available shape: the command SUCCEEDED and reinstalled
the version you already had, so it read as "upgrade is broken" rather than
"the registry answer was stale". `--prefer-online` forces the read.

## Skill target picker

`add skills` wrote every detected agent folder. It now offers an arrow/space
multi-select first, all checked — the Puzzle CLI's prompt, ported.

Hand-rolled on raw-mode stdin rather than adding a prompt library: this is a
globally installed CLI, and one checkbox list does not justify a dependency
tree on every install. `serve`'s "press q to quit" set the precedent.

## Notes

Two things the first cut got wrong, both about what "no selection" means.
**Cancelling is not an empty selection** — Esc / Ctrl+C now return a distinct
`null` so a dismissed prompt cannot read as consent to install nothing. And
**stdin EOF hung forever**, waiting on input that was never coming; it now
cancels. That one surfaced by wedging a pty test for two minutes.

The key handling is a pure reducer (`applySkillPickerKey`) precisely because
driving raw-mode stdin from a test needs a pty and hangs when input runs out —
so the escape codes and wrap-around are unit-tested and the terminal plumbing
is the only untested part. The port walk is covered the other way: an
integration test against the real binary, confirmed to fail against the old code.
