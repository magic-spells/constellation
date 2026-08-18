---
name: Change tracking & sync
kind: spec
status: verified
connections:
  - FILE-GIT
  - FILE-SYNC
  - FILE-STALE
  - DOC-MCP-UPGRADES
verified_at: '2026-08-16T02:39:51.183Z'
verified_sha: c813887e9d1d4021d5129c1534e33f12efbc533d
section: plan-and-code
order: 10
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

**Per-card drift is card-relative** ([[FILE-STALE]]): a claim card is measured against its
own last commit, so code committed after its card is drift and a card committed with its code
is not. The marker is only the *fallback* for cards git has never seen change — keeping it
current is an option, not a chore.

**Format review** — the same marker file carries `format_review`: the Constellation version
whose file-format rules the plan was last reviewed under. It is provenance like `verified_sha`,
not a change flag, and it exists because 0.5.0 stopped treating a `[[link]]` as an edge — a plan
authored earlier can be holding real relationships in prose only. Absent (or no marker at all)
means never reviewed, and the MCP server appends a one-time upgrade-review paragraph to its boot
instructions ([[DOC-MCP-SERVER]]) until `set_sync_point format_review: true` records the review.
`init_plan` stamps it at creation, so plans born on 0.5.0+ never see it.

**Lifecycle** — `status` (`planned`→`building`→`built`→`verified`) is a card property,
orthogonal to history. Verify only against real code.

**Verification provenance vs. change tracking** — the one recorded per-card baseline is
`verified_sha` / `verified_at`: `set_verified` stamps the sha a card was checked at. That's the
basis of a *claim*, not a change flag — and the drift *verdict* ("has the bound code moved
since?") is recomputed live by `stale_report` / `check_sync` ([[FILE-CODE]]), never stored.
This reconciles the "no per-card stamping" rule rather than breaking it. See [[DOC-MCP-UPGRADES]].
