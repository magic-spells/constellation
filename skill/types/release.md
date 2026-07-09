# RELEASE cards (`RELEASE-`, `release/`)

One card per version milestone: the **theme and intent** of a release, what's
targeted at it, and the migration/upgrade notes users need. FEATURE cards point
here via their `release:` field — the release is the milestone, features are the
work.

**A RELEASE card is not a changelog.** What actually shipped is git's job (tags,
`diff_plan`, `plan_log`) — never enumerate commits or card-by-card changes in
the body. Card what git *can't* say: why this release exists, what it's named
for, what a consumer must do to upgrade.

| Field | Type | Notes |
|---|---|---|
| `version` | string | exact version string, e.g. `1.1.0` (the handle is the identity: `RELEASE-V1-1-0`) |

`status` is the milestone's arc: `planned` = targeted/next; `building` = in
flight; `built` = shipped/tagged; `verified` = validated in production.

Example — `constellation/release/RELEASE-V1-1-0.md`:

```markdown
---
name: v1.1.0 — assignment automation
status: planned
version: 1.1.0
---

# v1.1.0 — assignment automation

Theme: stop tickets from sitting unassigned. Everything in this release serves
median first-response time.

## Upgrade notes

- New env var `ASSIGN_INTERVAL_SECONDS` (default 30); no schema migration.
```
