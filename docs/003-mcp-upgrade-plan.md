# 003 — Constellation MCP Upgrade Plan

_Status: **implemented** (branch `feat/mcp-upgrades-003`). Authored 2026-06-19 from two agents using Constellation as cross-session memory during a real build (a Claude building `pyramid-server`'s GitHub integration + a Claude building `pyramid-web`). Companion to [002-mcp.md](./002-mcp.md)._

> **Implementation status (2026-06-19).** Phases 0–6 all landed, with tests:
> - **0** framing → MCP `instructions` + `skill/SKILL.md` + `skill/methodology.md` (all three copies).
> - **1** cheap writes → `append_note`, `edit_section` (byte-preserving).
> - **2** binding + baseline → `set_verified`; cross-type `code_refs` / `verified_sha` / `verified_at` / `notes` live in `schemas/card.json`, blessed on all 17 types via `validate.ts`.
> - **3** detect → `stale_report` (per-card reverse drift vs `verified_sha`).
> - **4** attach → `get_card(code: "paths" | "direct")` with size caps + skips (`src/core/code.ts`).
> - **5** assemble → `assemble` (work package + file-disjoint fan-out units).
> - **6** enforcement → `check_sync` (exposes the existing `computeSyncStatus` over MCP + per-card drift; advisory, can't block).
>
> **Deferred / decided:** the optional *memory-structure* extras — a dedicated `DECISION` card type and a structured partial-status model — are **not** built; typed `notes` (`kind: decision | state | …`) cover most of that need for now. Code *attach* is intentionally **same-repo** (cards never bind across repos — the invariant holds; reach a sibling's code via the `repo` selector). The "no per-card stamping" format rule was reconciled, not broken: `verified_sha` is verification *provenance* (a recorded claim baseline), while the drift *verdict* is still computed live and never stored.

## Why this plan exists

Constellation is used as **durable, cross-session, cross-agent memory** for AI coding agents. Every session an agent pays a "discovery tax" — building a mental model of the code before it can act. Without a place to bank that understanding it evaporates at session end and the next agent re-pays it in full. Constellation's value is that the understanding **compounds** instead.

Two failure modes erode that value; this plan attacks both:

1. **Drift** — a card's claim (`status: built`, a DDL block, a "not built yet" note) silently diverges from the code. *A card you can't trust is worse than no card.*
2. **Friction** — updating a card is expensive (today it's a full-body replace), so agents skip it — which *causes* drift.

### Design principles (apply to every change below)

- **`built` is a claim that outlives its author.** The agent reading a card next isn't the one who verified it and can't see the basis; code drifts after marking; even a careful agent can miss a path. So claims must be **re-verifiable**, not taken on faith forever. This is *durability, not distrust* — the same reason you keep tests even though you trust the author.
- **Card what code can't say** — intent, decisions, current state, gotchas, cross-cutting rules. **Don't duplicate** DDL / signatures / code that lives in the repo; link to it. Copies drift; the repo is the source of truth.
- **Make the honest path the cheap path.** Most drift is just skipped updates. Lower the cost of a small correction and cards stay true.
- **Purpose belongs in the intro.** The MCP `instructions` are loaded every session; stating what Constellation is *for* and how to treat it changes agent defaults more than any tool.

---

## The two headline capabilities

Everything else ladders up to two things agents actually want the MCP to *do*.

### A. "Hand me the delta" — what changed since I last looked

Given a sync marker (or explicit handles), report what changed and hand back a ready-to-work bundle. Two directions:

- **Plan-side** — which cards changed. ✅ **Already exists** — `diff_plan` reports per-card changes since the sync marker / HEAD.
- **Code-side** — which cards are bound to code that changed *without the card moving* (reverse drift). ❌ **Missing — the core new capability.**
- **Assemble** — turn that delta into a work package: changed cards + their connected cards (full) + the bound code + a suggested dependency order, optionally split into file-disjoint units for fan-out.

### B. "Hand me the code behind a card"

When a card connects to FILE cards (which carry a `path:`), optionally attach the live file — so an agent starts from *intent + current reality* in one call instead of a card describing code it then has to hunt down.

```
get_card(handle, connected: "full", code: "none" | "paths" | "direct")
```
- **`paths`** — return resolved file paths of *directly*-connected FILE cards. Cheap; the agent Reads what it wants. Default for interactive agents.
- **`direct`** — attach the *contents* of directly-connected FILE cards (capped). For background / fan-out coders that shouldn't need a second round-trip.
- Resolves **cross-repo** via `connected_repos` — a `pyramid-web` card can pull the real `pyramid-server` file it's bound to.

These two share machinery: **Assemble (A) reuses B's path-resolution** to attach each coder's files to its work package.

---

## Supporting infrastructure (what A and B need underneath)

### Binding — how a card points at code _(foundational; A and B both need it)_
Today the only binding is a FILE card's `path:`. Keep that as the primary binding; add an optional `code_refs` (`path` or `path:symbol`) on any card for precision. **Recommendation:** FILE-`path:` is the default; `code_refs` only where drift precision earns its keep, so you don't tax every card.

### `verified_sha` / `verified_at` _(foundational; A's code-side drift needs a baseline)_
When a card is marked `built`/`verified`, stamp the git sha + timestamp it was verified against. Code-side drift then = "bound files changed since `verified_sha`." Without a baseline there's nothing to diff against.

### Cheap writes _(kills the #1 drift cause)_
- `append_note(handle, kind, text)` — append-only, **no full-body rewrite**. `kind ∈ {decision, gotcha, state, deviation, verified}`. _(Audit `plan_log` first — it may already cover part of this; if so, surface it in the intro so agents reach for it.)_
- Section-level edit — replace a single `##` section.
- **Compaction / filtering** so append-only notes don't bloat a card — retrieval returns latest-N or filters by kind.

### Memory structure _(so the gold is queryable, not buried in prose)_
- First-class typed notes (state / gotcha / decision / deviation) instead of free-text provenance, so a tool can answer *"show every known limitation in area X."*
- **Partial status** for half-built cards: `{ built: [...], pending: [...] }` or per-section — instead of jamming "inbound done, outbound not" into one enum + prose.
- Optional `DECISION` card type (or decision log): rationale + rejected alternatives — the highest-value "don't re-litigate" memory.

---

## Phased rollout (by leverage-per-effort)

| Phase | What | Why here | Effort |
|---|---|---|---|
| **0** | **Reframe the MCP `instructions`** — purpose (memory/compounding), discipline (update cards as part of *done*), content rule (intent yes / code-copies no), durability framing, "a card you can't trust is worse than none." | Loaded every session; changes defaults; **zero code**. | XS |
| **1** | **Cheap writes** — `append_note`, section edit, note compaction. | Removes the friction that causes drift. | S |
| **2** | **Binding + `verified_sha`** — FILE `path:` (+ optional `code_refs`); stamp sha/time on verify. | Foundational for 3–5. | S–M |
| **3** | **Detect** — code-side drift report (`stale_report`) atop the existing `diff_plan`. | Makes `built` re-verifiable. | M |
| **4** | **Attach** — `get_card(..., code: "paths"\|"direct")` with guardrails. | Capability B; high value every session. | M |
| **5** | **Assemble** — `assemble(delta\|handles)` → work package + file-disjoint fan-out units. | Capability A; bridges to multi-agent orchestration. | M–L |
| **6** | **Enforcement** — `check_sync` / definition-of-done hook: code changed without bound cards re-verified → surface/block. | Takes "remember to sync" off the human. | M |

**If you only do three:** Phase 0 (framing), Phase 1 (cheap writes), Phase 4 `paths` mode. They change every future session for modest code.

**Sequencing:** 0 → 1 → 2 → (3 ‖ 4) → 5 → 6, with the memory-structure track folded into 1 and 3.

---

## Guardrails for Attach (B) — the craft is here

Without these, attaching files backfires (token blow-up buries the one file you wanted):

- **Opt-in + scoped** — `code: "direct"` attaches only *directly*-connected FILE cards, never the whole neighborhood.
- **Size caps** — per-file cap with truncation noted; total budget reported.
- **Missing / moved file → drift warning, not an error** — a stale `path:` is a useful signal (feeds Detect).
- **Skip** binaries, lockfiles, generated output.
- **`paths` is the cheap 80%** — return resolved paths, let the agent Read selectively. Default for interactive use; `direct` for background coders.

---

## Proposed tool surface (sketch)

```
# existing
diff_plan(base?)                       # plan-side delta (per-card changes)            ✅ have

# new
append_note(handle, kind, text)        # append-only; no full-body rewrite              P1
set_verified(handle, sha?, note?)      # stamp verified_sha + verified_at               P2
stale_report(base?)                    # cards whose bound code changed since verify     P3
get_card(handle, connected, code)      # code: "none" | "paths" | "direct" (+ caps)     P4
assemble(delta | handles, code?)       # work package: cards + connected + code + order  P5
check_sync()                           # code touched without bound cards re-verified    P6
```

---

## The one decision everything hinges on

**Code-binding granularity.** FILE-`path:` only is simplest but coarse (file-level drift). `path:symbol` gives precise drift detection at higher authoring cost. **Recommendation:** FILE-`path:` as the default binding for most cards; `code_refs` with symbols only where precision earns its keep. Detect's precision, Attach's accuracy, and Assemble's bundles all ride on this choice.

---

## Provenance

Synthesized 2026-06-19 from two Claude agents using Constellation as working memory across the `pyramid-server` + `pyramid-web` build:
- **Intro-purpose framing, write-friction, memory-structure, phasing** — pyramid-server Claude.
- **Durability-not-suspicion framing for verification, the Detect/Assemble split, attach guardrails + `paths`-vs-`direct` modes** — pyramid-web Claude.
