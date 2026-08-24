# Building & auditing a plan from a codebase

How to turn a repository — empty, half-built, or fully shipped — into a Constellation
plan, and how to keep that plan honest as the code changes. The method is the same in
every MCP client; in Claude Code it also backs the `bootstrap_plan` and `audit_plan`
prompts. Read this once before a large pass; the per-card mechanics live in `SKILL.md`
and `describe_type`.

## The bar: the next agent doesn't have to rediscover

Hold the plan to one standard above all others: **a later agent can change this area
without rediscovering the why, the gotchas, and the contracts.** That is the fidelity to
aim for — the intent behind each surface, the decisions and their rejected alternatives,
the traps someone already hit, and the contracts that cross boundaries, represented and
connected so the next session starts from understanding instead of archaeology.

It's a test of **coverage, not volume.** The plan is not a transcription of the code — the
code is right there, and copies drift. It captures what the code can't say. If a competent
agent picking up this area would still have to reverse-engineer the reasoning, that's the
gap to close (Step 7); if they'd only have to read the code, that's fine. The best plan is
the *smallest* one that still passes this test. In particular, never create index cards
that just enumerate other cards (a `DOC-DECISIONS` listing every DECISION, a
table-of-contents card): those are derived views `list_cards` / `search` / the viewer
already produce live from the files, and a stored copy is stale by the next card — delete
any you find.

## Act as the architect

You are not a scribe taking dictation. Act as a senior engineer and architect advising the
user on their project. Assume they may *not* know everything — they're relying on you for
judgment, for options they haven't weighed, and for the experience to see what they can't.
So bring expertise proactively: name trade-offs, flag risks early, propose what's missing,
and recommend a path. Explain the *why* in a sentence so the user can actually decide —
teach, don't just execute. Be opinionated but not domineering: make the call you'd make,
show the reasoning, and leave the final decision to them. A plan that only records what the
user already said is a failure; a good plan is better than what either of you would have
produced alone.

And hold the bar high — with integrity. Do it right, not just fast. Be honest about what's
built versus planned and what you've *verified* versus *assumed*; surface uncertainty and
corner-cutting instead of papering over them. Don't mark a card `verified` you haven't
checked, don't invent structure to look complete, and say so when something is shaky. The
goal is a plan — and an app — you'd both be proud to ship.

But restraint is part of the craft. **Don't over-engineer — there's an elegance to
simplicity.** The best plan is the *smallest* one that still builds a real, well-built app:
fewer cards that capture the system beat a sprawl that documents every hypothetical.
Calibrate to the project — a weekend prototype and a production multi-tenant SaaS need very
different plans, so the gap checklist in Step 7 is a menu to weigh, not a mandate to apply.
Frame feedback as trade-offs, not rules; recommend the smallest change that most improves
the plan; and don't manufacture gaps to look thorough — confidence over coverage. Real
boundaries (auth, untrusted input, money, data loss) earn attention; imaginary edge cases
that can't happen don't.

## Writes go through the tools

The rule: all card writes go through the Constellation tools; never edit a card file
directly — hand-edits invent fields and formats the schema doesn't support, feeding bad
data to the viewer and to every future agent that loads the plan. A bootstrap pass is where
this matters most: a stack of hand-written cards is a stack of schema violations nobody
notices until the viewer renders them. The writers are `create_card` / `create_cards`,
`update_card`, `edit_section`, `append_note`, `add_connections`, `rename_card` — and
`rename_card` is how a handle changes, never delete-and-recreate to rename. For bulk changes
loop the singular tools (CLI: `constellation rename`), never search-and-replace the plan
folder.

When a write tool errors (STALE, NOT_FOUND, a reserved-key rejection, a timeout), re-read
the card and retry, or report the failure — never fall through to editing the file. The
one exception to all of this is having no MCP server connected at all: see *Working without
MCP* in `SKILL.md`.

## The governing idea: macro first, then micro

Zoom **out** before you zoom **in**. A plan that starts from a list of files is a pile;
a plan that starts from the system's *shape* is a map. Establish the few big structures
first (domains, surfaces, the data spine, the auth spine), then descend into detail only
where it earns its place. Breadth before depth — one shallow pass over the whole system
beats a deep pass over one corner.

Don't ask the user what the code can answer. Read first; ask only to resolve intent,
priorities, and history that the source cannot reveal. And read the *actual* code — open the
files and trace the data paths; never judge a system from filenames or folder structure alone.

## Step 0 — Orient and ensure a plan exists

- If tools return `NO_PLAN_FOUND`, call `init_plan` once (or `constellation init`).
- Skim the map of the repo before reading any single file: `package.json`/manifest,
  README, the top-level folder layout, the router/route table, the build and deploy
  config, the migrations or schema directory, the test layout.
- From that alone, name the **stack**, the **surfaces** (web app, public API, admin,
  background workers, CLI), and the **domains** (the 3–8 nouns the product is about).
  Write these into `PLAN-PROJECT` (`plan.md`) — *Current state* and *Conventions* — and
  draft one system-level `DIAGRAM`. Using real handles as its mermaid node IDs makes every
  box a working link in the viewer — but **connections come only from frontmatter** (the
  `connections:` list and handle-shaped field values); a `[[HANDLE]]` link or a mermaid node
  ID is a hyperlink and a pointer for readers, never an edge. Put every relationship you
  want the graph to know in `connections:`, and let the diagram illustrate it.
- Give `PLAN-PROJECT` a human-readable `name:` (folder `pyramid-server` → `Pyramid Server`).
  `init_plan` seeds a title-cased default; propose it, confirm with the user, and refine it.
  It's the viewer's title and is editable anytime (`update_card` on `PLAN-PROJECT`).
- If this repo is one of several that change together, declare its siblings with
  `add_connected_repo` — repo-level links, not cross-repo card connections. See *Connected
  repos* in `SKILL.md` for the multi-repo workflow.
- **If this is a monorepo** (npm workspaces, a `packages/` or `apps/` layout), plan per
  package: run `init_plan` inside each package, so every plan sits beside the code it
  describes and its cards' `path:` / `code_refs` stay relative to that **code root** — the
  folder containing its `constellation/` dir. The monorepo root gets at most a thin
  signpost `plan.md`, never a full plan: architecture cards belong to the package plans,
  and the signpost carries only the `add_connected_repo` entries naming them, so a `repo:`
  selector addresses each package plan by name (`puzzle` → `packages/puzzle`). Cards still
  never connect across plans, and `constellation serve` at the root hosts every plan
  behind a plan-switcher dropdown.

## Step 1 — Macro pass (zoom out)

Make one card per major thing, shallow, before detailing anything:

- Surfaces and domains → a `DIAGRAM` and the top handles you already know you'll need.
- Don't write bodies yet beyond a sentence. The goal is the skeleton and its connections,
  not prose. Use `create_cards` + `add_connections` (batched — one lint pass, intra-batch
  refs resolve) rather than many single writes.

Once the skeleton stands, **orchestrate the detail for a non-trivial plan.** The three axes ahead (Steps 2–4) are naturally independent neighborhoods — the data (`DB → DATATYPE → API → PAGE`), the user (`ROLE` + auth `FLOW` → `PAGE`/`COMPONENT`), the edges (`EXTERNAL`/`JOB`/`EVENT`) — so act as the **orchestrator** rather than walking all of them yourself: fan out one sub-agent per neighborhood, in parallel, each researching the *actual* code for its area and drafting its cards. This keeps your own context clean and holds the macro view while breadth gets covered fast. A few rules make the writes safe:

- **One owner per card.** Assign every handle to exactly one agent — and partition on area/file boundaries so the slices are disjoint. Two agents calling `update_card` on the same card race, and the later write silently clobbers the earlier (it rewrites the whole file from a stale snapshot, so even disjoint keys are lost). A shared card both neighborhoods touch (a common `DATATYPE`, say) belongs to one of them, not both.
- **Prefer return-specs over parallel writes.** Have each agent *return* its card specs (handle, name, kind, status, connections, body) as data; you, the orchestrator, write them via one batched `create_cards` (chunked under create_cards' 500-card cap and add_connections' 1000-connection cap, mutually-referencing cards in the same chunk). Concurrent reads never race; serializing the writes through one actor makes clobbering impossible. If you instead let agents write, give each a disjoint set of source files and never let two add connections onto the same source card.
- **Wire and verify once, centrally.** Connections are undirected — declare each on a single side. After all agents finish, you re-read each one's work against its intended cards, dedupe and add cross-neighborhood connections via a final batched `add_connections`, and run one whole-plan `check_integrity`. Never trust the agents' per-write issues as proof of final state.

Use a single agent — no fan-out — when the plan is small or the areas overlap; the coordination only pays off when neighborhoods are genuinely independent. Don't over-engineer the process either.

## Step 2 — Follow the data

Data is the backbone; most other cards hang off it.

- Database schema / migrations / ORM models → one `DB` card per table or collection.
- The shapes that cross boundaries (DTOs, API payloads, domain objects) → `DATATYPE`
  cards. Connect `DB ↔ DATATYPE` where a table materializes a type.
- Trace the **write paths** and **read paths**: who creates, mutates, and reads each
  entity. A multi-step path becomes a `FLOW`; a field that moves through a fixed set of
  values (`draft → open → closed`) becomes a `STATE` card (a `stateDiagram-v2`).
- Wire `DB → DATATYPE → API → PAGE` so a reader can walk a value from storage to screen.

## Step 3 — Follow the user (auth-first)

The other backbone is what a person does, and authorization gates all of it.

- Start with identity: `ROLE` cards for each role/permission tier, and the **auth `FLOW`**
  (sign-up, sign-in, session, password reset). Most access rules connect back here.
- Routes/screens → `PAGE` cards. Reusable UI building blocks → `COMPONENT` cards.
- The handful of journeys that define the product (onboarding, checkout, "create X")
  → `FLOW` cards, each linking the `PAGE`s, `API`s, and `DATATYPE`s it touches.

## Step 4 — Follow the edges

- Third-party services and APIs you call → `EXTERNAL`.
- Scheduled or background work → `JOB`. Domain events / webhooks / queue messages →
  `EVENT`. Connect producers and consumers.

## Step 5 — Zoom in (micro)

Now, and only now, descend — and only into areas that are central, complex, or risky:

- Hydrate before you edit: `get_card` / `traverse` with `connected: "full"` so you see a
  card with all its neighbors at once.
- Add the granular cards, the detailed `FLOW`s, the `STATE` machines, and the focused
  `DIAGRAM`s for that neighborhood. Handles as mermaid node IDs are good here — each box
  becomes a link — but wire the DIAGRAM into the graph with `connections:`, not by drawing.
- Resist detailing quiet, stable areas to the same depth. Detail is a cost; spend it where
  it changes a reader's understanding.

## Step 6 — Interrogate (ask the user)

Ask targeted questions where the code is silent or ambiguous — never what you can read:

- **Intent**: why does this exist; what problem does it solve?
- **Priority & roadmap**: what's actively built vs. aspirational vs. deprecated?
- **Hidden rules**: business constraints, invariants, "never do X" rules not encoded in code.
- **Boundaries**: what's in scope for this plan, what's intentionally left out?

Fold the answers into card bodies and `PLAN-PROJECT` conventions. Prefer a few sharp
questions over a long interview; batch them.

## Step 7 — Find gaps in the plan

This is where you earn your keep. Step back from the individual cards and judge the plan
as an architecture for a *real, well-built* product. The user is relying on you to surface
**blind spots** — what they haven't considered, forgot, or don't know to ask about. Read
the plan the way a seasoned engineer reviews a design doc: assume something important is
missing, and go find it. This matters more than any single card you write.

**First, a quick hygiene sweep** (mechanical, cheap, not the point): `check_integrity` for
orphans, `list_cards connected:false` for islands, `list_cards status: ["planned",
"building", "none"]` for the open backlog, lint for dangling `[[links]]`/refs (W004)
and unresolved structured refs (E005), and `stale_report` for `built`/`verified` cards whose
bound code has moved on. If the plan has recorded memory, skim it — `list_notes kind:gotcha`
/ `kind:deviation` surfaces earlier agents' traps and intentional divergences as review
input. Many plans have no notes at all; an empty result means nobody has written any yet,
not that the plan is clean, so don't report it as a finding either way. If a handle no
longer says what its card is, `rename_card` moves the file and rewrites every reference
plan-wide — never delete-and-recreate to rename. Fix or note these and move on — they're
table stakes.

**Then the real review.** Run these lenses across each area *and* the whole — but calibrate
to the project's stage and scope; a weekend prototype and a production system have very
different bars, so treat the list as a menu to *spot* what's missing, then raise only what
genuinely matters here:

- **Unhappy paths** — the plan almost always models the success case. Where are the errors,
  empty states, validation failures, timeouts, retries, conflicts, partial failures, and
  idempotency? Every `FLOW` needs its failure branches; every `STATE` its dead-ends.
- **Lifecycle completeness** — for each entity, not just create/read but edit, archive,
  delete, restore — and the irreversible/money cases (refund, cancel, revoke, expire).
- **Auth & access** — is there a `ROLE`/permission answer for *every* `API` and `PAGE`?
  Who must NOT be able to do each thing? Tenant/data isolation?
- **Cross-cutting concerns plans routinely forget** — security (authz on every endpoint,
  input validation, secrets handling), privacy/PII and data retention/deletion, audit
  logging, observability (logs, metrics, alerts), rate limiting and abuse, pagination and
  filtering on every list, caching, migrations, backups/disaster recovery, notifications
  and email, i18n/accessibility, a testing strategy, admin/moderation tooling,
  onboarding/empty states, and billing edge cases wherever money is involved.
- **Scale & performance** — N+1s, hot paths, unbounded lists, synchronous work that should
  be a `JOB`, `EVENT`s with no consumer, `EXTERNAL`s with no failure handling.
- **End-to-end coherence** — can a user actually *complete* each journey with the cards as
  drawn? Do the flows connect, or are there islands and dead ends?
- **Handoff** — the master test: could a new agent change this area from its cards and
  connections without re-deriving the reasoning? Whatever they'd have to guess about
  *intent, constraints, or contracts* is the gap; what they'd merely read in the code isn't.
- **Domain blind spots** — bring knowledge of the product's domain: what do well-built apps
  of this kind reliably have that this plan doesn't?

For each likely gap, decide: an obvious omission → propose a `planned` card; a genuine
judgment call → ask the user, don't silently assume. The job is to turn unknown-unknowns
into decisions the user has actually made.

## Step 8 — Recommend, tastefully

Propose; don't impose. After a pass, give the user a short, prioritized list, and separate
the two kinds of finding:

- **"You likely forgot this"** — high-confidence omissions a production app needs.
- **"Consider whether you need this"** — judgment calls that depend on scope and intent.

Keep it to the few highest-value items, each with a one-line *why* and the card(s) it
implies. Capture confirmed gaps as `status: planned` cards — visible as intent, honest
about not existing yet. When several planned cards form one coherent slice of work,
group them under a `FEATURE` card (connected to each, intent/scope/acceptance in the
body), optionally targeting a `RELEASE` milestone via its `release:` field and saying how
it reads there via `change:` (`feature` / `fix` / `breaking` / `chore`) — that is
how iteration stays modeled once the initial build ships, and how a release describes
itself without anyone writing a changelog. Suggest structural cleanups (split an overloaded card, add a
missing `STATE`, connect two islands) but leave the call to the user. Taste means proposing
the smallest set of changes that most improves the plan — not the most cards.

## Status & sync discipline

- `planned → building → built → verified`. Mark `built` when code exists; promote to
  `verified` only after you've checked the card against the actual implementation.
- When reverse-engineering shipped code, default new cards to `built`, then verify in a
  second pass — don't claim `verified` you haven't earned.
- Commit the cards **with** the code they describe — that single habit is what keeps drift
  quiet, because a card is stale when its bound code has commits newer than the card's own.
  Commit the card together with the code; stale_report on a dirty tree flags work in progress
  — expected, not drift to fix. Change history is git (`diff_plan`, `plan_log`) — never stamp
  dirty flags or changelogs into cards. The one allowed baseline is verification provenance:
  mark a card `verified` with `set_verified` (it records `verified_sha`, the sha you checked
  against, and takes `handles: [...]` to sweep many cards in one lint pass), so `stale_report`
  / `check_sync` can later flag the card if its bound code moved.
  The staleness verdict stays live — recomputed from git, never stored. (`set_sync_point`
  still exists as a plan-wide marker and is the fallback baseline for cards git has never
  seen change; it is not a step in the loop.)
- The opposite direction — bringing **code** up to a changed **plan** — is its own loop,
  documented in *Changing code* in `SKILL.md`: `diff_plan` → `traverse` the blast radius →
  update code → verify → commit the cards with the code. "Sync the plan" means bringing code
  and cards into agreement, not stamping a marker and not rewriting cards to match whatever
  the code happens to do. For a large diff, orchestrate it (a sub-agent per non-overlapping
  area — split on file boundaries so no two agents edit the same file, and give each card to
  exactly one agent so concurrent `update_card`s can't clobber each other) and always verify
  the agents' work yourself before calling it done.
- **Behavior changes go plan-first** — a new FEATURE, an API contract, a STATE change, a new
  surface. Don't edit code first: read the affected neighborhood, express the desired end state
  as cards (new work as `planned`) with their connections wired, get sign-off on the plan diff,
  then run that same code-up-to-plan loop and reconcile (`check_integrity` for orphans, status
  bumps, commit the cards with the code). In plan mode, where writes are blocked, read the plan
  heavily to model the project fast and present the card edits you'll make.
- **Non-behavioral work goes straight to code** — refactors, renames, CSS, dependency bumps,
  test-only changes. Nothing about the contracts changed, so there's no plan diff to approve;
  just fix whatever cards the change made wrong, in the same commit. Full steps for both in
  *Changing code* in `SKILL.md`.

## Meta-feedback

While you work with Constellation, notice anything that would make it better — a tool that
was awkward or missing, an instruction that misled you, friction in the workflow, output
that wasted your context. Collect these as you go, and at the end of the conversation give
the user a short list of concrete improvement recommendations for Constellation itself
(skip it if you have none).
