---
name: v0.5.2 — CLI friction
status: building
version: 0.5.2
---

# v0.5.2 — CLI friction

Three papercuts, all reported within an hour of shipping 0.5.1. Theme: the CLI
should do the obvious next thing instead of explaining why it stopped.

## Upgrading

No migration steps, and no plan-format change.

**`serve` no longer refuses a busy port.** It walks upward until one binds and
prints where it landed. A script that relied on exit code 2 for "port taken"
will now get a running server on a nearby port instead — pass an explicit `-p`
and check the banner if that matters.

**`upgrade` reads the registry fresh.** Anyone who ran `constellation upgrade`
in the minutes after a release and got the version they already had was hitting
npm's cached packument, not a failed install.

**`add skills` asks which folders to write.** Existing non-interactive
behaviour is unchanged: no TTY still installs every detected target, and
`--skill-root` still pins them explicitly.
