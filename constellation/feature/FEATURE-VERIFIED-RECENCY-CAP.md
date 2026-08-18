---
name: Cap the Verified column at the 20 most recent
status: verified
change: feature
connections:
  - PAGE-VIEWER-BOARD
  - PAGE-VIEWER-FEATURES
release: RELEASE-V0-6-0
notes:
  - kind: state
    text: >-
      Built. Kanban gained two optional column keys — `total` (the count badge reads it instead of
      cards.length) and `overflow` ({text, href}) — so the cap is BoardPage policy, not board
      behaviour. Left `set_verified` as the only stamper of `verified_at`; an unstamped verified
      card sorts below every stamped one on the mtime fallback.
  - kind: verified
    text: >-
      Verified at 0.6.0 by test, not by eye: the cap is conditional on more than 20 verified cards,
      which this plan does not yet have. tests/viewer/pages.test.js covers the overflow row ("+3
      more verified") and the recency sort.
    sha: 2790152d9503b921ee03c26f14a5f9e31b0b70f1
branch: feat/viewer-polish
verified_at: '2026-08-18T04:42:10.223Z'
verified_sha: 2790152d9503b921ee03c26f14a5f9e31b0b70f1
---

Planned, Building and Built all drain — a card leaves them. **Verified does
not.** Every feature ever shipped accumulates there forever, so on a mature plan
the board stops answering "where is everything right now" and becomes a
changelog with three short columns next to an endless one.

Show the 20 most recently verified, then a footer row — *"+N more verified"* —
linking to the list view. The cap belongs to the **board**, not to the data:
[[PAGE-VIEWER-BOARD]] is the snapshot, [[PAGE-VIEWER-FEATURES]] is the archive
and stays complete.

## Ordering needs a date, and we already have one

`verified_at` is an existing cross-type key in `schemas/card.json`, stamped by
`set_verified` alongside `verified_sha`. Every currently-verified FEATURE card in
this plan carries one, so the ordering key exists — this feature just has to
start using it.

The board today sorts every column by card **file mtime**, which is wrong here:
any edit to an old card — a typo fix, a note append — jumps it back to the top of
Verified as though it just shipped. Sort Verified by `verified_at` descending,
falling back to mtime and then handle when a card was flipped to `verified` by a
plain status write with no stamp.

Worth deciding while here: should flipping `status: verified` through
`update_card` stamp `verified_at` too, or does an unstamped verified card stay a
second-class citizen with an mtime fallback? Leaning: leave `set_verified` as the
only stamper (it is the provenance tool) and keep the fallback.

## Extensions this opens up

Once features carry `release:`, the Verified column can group under release
dividers — *"shipped in v0.5.2"* — with everything older than the newest two
releases collapsed. That is more meaningful than a flat count, because "the last
20" is arbitrary while "since the last two releases" is a real boundary. Ship
the count cap first; it is unconditional and needs no release data.

## Open questions

- Is 20 the right number, or should it be recency-by-time (90 days)? Count is
  predictable and layout-stable, so start there and make it a constant, not a
  setting.
- Should Built get the same treatment? It should drain into Verified, so no —
  but if a plan is seen where it doesn't, the same mechanism applies.

## Acceptance

- A plan with 50 verified features renders 20 cards plus one overflow row on the
  board; the list view still shows all 50.
- Verified is ordered by `verified_at`, and appending a note to an old verified
  card does **not** move it up the column.
