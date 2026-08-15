---
name: Viewer — home
kind: route
status: built
code_refs:
  - viewer/app/views/Home.pzl
  - viewer/app/lib/dashboard.js
  - viewer/app/lib/icons.js
---

The viewer landing page: a status board for the plan. Served by [[FILE-SERVE]].

Four blocks, in order: the **health strip**, the **panel grid**, the `PLAN-PROJECT` body (editable in place), and connected repos. The page widens to 96rem for a two-column panel grid (one column under 900px) while the prose stays capped at 70rem so its left edge lines up with the panels.

**Health strip** — the freshness verdict ([[COMPONENT-SYNC-BADGE]] says the same thing in the topbar), the counts that qualify it (cards, connections, integrity, warnings, drift) and the one action that changes it: a **Set sync point** button that POSTs `/api/sync-point`. Stamping the marker is what gives every claim card a drift baseline, so it is the fix the drift panel points at. The strip replaced both the old sync panel and the standalone stat row — the numbers only mean something next to the verdict. A `no-git` plan keeps the counts and loses the verdict and the button.

**Panels** — presentational, one `model` prop each, all built in `viewer/app/lib/dashboard.js` from the `/api/sync` payload plus the store:

- **Releases** — a timeline of every RELEASE card, newest first (numeric per segment, so 0.10.0 beats 0.9.0). The in-flight release (newest not built/verified, else simply the newest) starts expanded with a progress bar and its FEATURE cards grouped by `change:` — Breaking, Features, Fixes, Chores — and the rest collapse to a summary line you can open. A release whose `version` matches the newest git tag is marked tagged. Contents are always *derived* from FEATURE cards pointing at the release; nothing changelog-shaped is read off the RELEASE card.
- **Activity** — one stream, plan commits and code commits interleaved newest-first and tagged by kind. The server reports them separately and they are disjoint, but they answer one question, so splitting them across two panels only made the reader merge by timestamp.
- **Code drift** — the `stale_report` verdict as a *verdict*: one coloured headline, then at most six named stale cards with the overflow counted. Claims with no reachable baseline collapse to a single counted line carrying the fix (set a sync point, or `set_verified`) — on a never-synced plan that bucket holds every claim card, and rendering them as rows said nothing. Hidden entirely on a `no-git` plan.
- **Notes** — the latest `append_note` memory across cards, ordered by card mtime, toned by kind.

Icons and tone come from `viewer/app/lib/icons.js` via [[COMPONENT-ICON]], so one glyph vocabulary covers every panel and colour is set once per row.

Deliberately absent: a type tile grid (the sidebar already lists every type with the same counts).
