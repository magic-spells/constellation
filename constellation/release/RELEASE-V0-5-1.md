---
name: v0.5.1 — Tasks
status: built
version: 0.5.1
---

# v0.5.1 — Tasks

Board and the features list stop being two destinations and become two views of
one. Theme: the rail should name what you are going to, not how it is drawn.

## Upgrading

No migration steps. Nothing about the plan FORMAT changes — this is viewer
navigation only, and the plan files a 0.5.0 viewer reads are the same files.

**Moved routes.** The board is `#/tasks/board` and the features list is
`#/tasks/list`, behind one **Tasks** sidebar row. `#/board` and `#/features`
still resolve, as redirects, so bookmarks and pasted links keep working — the
same treatment `#/card/HANDLE` got when card URLs moved.

**Fixed: an explicit sync-point revision corrupted the marker.** `set_sync_point`
with a `sha` argument wrote a two-line `--end-of-options\n<sha>` into
`.sync.json`, because `git rev-parse` echoes that flag back as output. A marker
holding it resolves to nothing, which reads as `marker_error` and pins the plan
at `drifted` permanently — and the same write dropped a recorded `format_review`.
The default (no `sha`) path was never affected. A plan whose marker already holds
the corrupt value is repaired by stamping a fresh sync point.
