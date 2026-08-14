---
name: Viewer — home
kind: route
status: built
code_refs:
  - viewer/app/views/Home.pzl
---

The viewer landing page: project overview, the freshness badge ([[COMPONENT-SYNC-BADGE]]), sync/integrity rollup with recent activity, per-status stat tiles, the `PLAN-PROJECT` body, connected repos, and the card catalog by type. Served by [[FILE-SERVE]].

The page is a mission-control dashboard: it widens to 96rem for a two-column panel grid (one column under 900px), while the `PLAN-PROJECT` prose stays capped at 70rem so its left edge lines up with the panels. Four panels sit above the stat tiles — **Drift** (the `stale_report` verdict, hidden on a `no-git` plan), **Release** (the latest git tag plus the `package.json` version, then the current RELEASE card's feature progress via `release:` — current being the newest release still unshipped, or simply the newest once everything has shipped — with an educational empty state when the plan has no RELEASE cards), **Code commits** (the code-side activity feed), and **Notes** (the latest `append_note` memory across cards, ordered by card mtime). Every panel is presentational — each takes one `model` prop built in `viewer/app/lib/dashboard.js` from the `/api/sync` payload, which carries the drift verdict and the code-side activity alongside the plan-side activity it already served.
