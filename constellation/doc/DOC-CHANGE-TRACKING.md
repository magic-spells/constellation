---
name: Change tracking & sync
kind: spec
status: built
---

# Change tracking & sync

**What changed is git's job**, never stamped into cards: `git diff <ref> -- constellation/`
*is* the plan diff. [[FILE-GIT]] exposes it as `diff_plan` / `plan_log`; plan changes ride
branches and PRs, and reviewing a plan PR is the human approval gate before an AI syncs code.

**Sync marker** — a reconciling agent records the last plan commit it synced code against in
`constellation/.sync.json` (plan-global, via `set_sync_point`). [[FILE-SYNC]]'s
`computeSyncStatus` reports `drifted` when the plan moved past the marker or code commits land
after it, and `marker_error` → `drifted` when the marker sha is unreachable (rebase / shallow
clone / hand-edited marker).

**Lifecycle** — `status` (`planned`→`building`→`built`→`verified`) is a card property,
orthogonal to history. Verify only against real code.

**Verification provenance vs. change tracking** — the one recorded per-card baseline is
`verified_sha` / `verified_at`: `set_verified` stamps the sha a card was checked at. That's the
basis of a *claim*, not a change flag — and the drift *verdict* ("has the bound code moved
since?") is recomputed live by `stale_report` / `check_sync` ([[FILE-CODE]]), never stored.
This reconciles the "no per-card stamping" rule rather than breaking it. See [[DOC-MCP-UPGRADES]].
