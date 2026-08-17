---
name: GitHub link moves to the top-right corner
status: built
change: chore
connections:
  - PAGE-VIEWER-HOME
release: RELEASE-V0-6-0
---

The GitHub link is the first item in the topbar's right-hand group, so it sits
between the plan name and the Search button rather than in the corner. Move it
last, after the appearance controls, so it lands in the actual top-right corner
where an "out to the repo" affordance belongs.

One change in `viewer/app/layouts/AppShell.pzl`: the `{#if repoUrl}` anchor moves
to the end of the `ml-auto` flex group. The link is still conditional — no
remote means no icon, not a dead one.

The topbar has no card of its own; it is described on [[PAGE-VIEWER-HOME]],
which is what to re-stamp when this lands.
