# Working memory

Cards say what the system **is**. Working memory says what we are **doing about it this
week**: what is in flight, in which worktree, held by which agent, what is next, what waits
on the user, what was decided tonight. It lives in `.constellation/` beside the plan folder,
gitignored, and it is read by the `working_*` tools and by `orient`. It is deliberately not
a card type and shares no vocabulary with cards.

The forcing function is context compaction. The compaction summary is generated from the
transcript and nothing you write can steer what it keeps. Working memory is the state that
must not depend on the summary: it is written to disk the moment state changes and read
back from disk right after the summary lands. Keep it true at all times and the cut can
land anywhere.

## The file

```
Updated 2026-09-17 06:56 · branch `release/0.1.0` @ 62da1b5 · next G3 C11 P4 F2 T15 Q8 I9 D12

## GOAL
- G1 [5] Finish Phase 6 so the platform can replace Clerk → [[FEATURE-PHASE-6-COMMERCE]]
## CONSTRAINT
- C3 [5] "Fable tokens use a lot of my limits" — Fable agents only for narrow core-auth passes
## PLAN
- P1 [4] ✓ orgs ✓ webhook → gate walk → deploy
## FOCUS
- F1 [5] Waiting on the Codex webhook re-review
## TASK
- T12 [4] Stripe webhook — wt stripe-webhook, 148846a, opus a2c1 → merge
## QUESTION
- Q2 [3] Cory: Stripe test keys + mapped prices
## IDEA
- I4 [2] No consumer for the account.anonymize job
## DECISION
- D6 [3] Personal orgs sealed — simpler, reversible
```

Eight types in fixed order, one line per item, an ID per type (`G1`, `T12`), importance
1–5 in brackets, free markdown text on one line. `[[HANDLE]]` links point into the plan and
create no graph edge. There is no status: an item is in the file or it has been dropped.
Dropping with a reason writes the reason to `log/YYYY-MM-DD.md`, which is the history.

## The tools

- `working_list { log? }` — the set; `log: "today"` adds the day's log lines. `orient`
  embeds the same `{header, items}` under `working` when the folder exists.
- `working_set { items: [{ id?, type?, importance?, text }] }` — create (give `type`) or
  update (give `id`). Batch several changes in one call; every write returns the new header.
- `working_drop { ids, reason? }` — remove items. This is "check it off". Give the reason.
- `working_log { text }` — append one line to today's log. The only write sub-agents make.
- `working_init { hook? }` — create the folder for an existing plan; `init_plan` does it
  for new ones. `hook: true` installs the SessionStart hook that re-prints the file into
  context after every compaction (see *After compaction*).

Errors: `NO_WORKING_FOLDER` (call `working_init`), `NOT_FOUND`, `TYPE_IMMUTABLE`,
`BAD_ID`, `BAD_TYPE`, `BAD_TEXT` (a newline). Long lines and crowded sets come back as
`warnings`, not errors.

## You infer it; nobody dictates it

The user will not tell you what to write down. They talk about the work: "let's get the
webhook merged before the deploy", "never touch production data", "I'd rather go with
SQLite", "can you check whether the job has a consumer?". Each of those is an item — a
GOAL, a CONSTRAINT, a DECISION, a TASK — and it is your job to hear it and record it in the
same turn, without announcing it and without asking permission. Listen for outcomes
wanted, rules stated, choices made, things only the user can answer, and alternatives
worth keeping; hear the type in the sentence. Likewise nobody tells you to drop an item:
when the work lands or the user moves on, the keep test fails and you drop it. Keep the
bookkeeping out of your replies; the user sees the file, not a narration of it.

## The rhythm

**Session start.** `orient` (or the hook's printout) gives you the set. Before acting, run
the keep test on every item and `working_drop` what fails. Then follow the `[[HANDLE]]`
links on the items you are about to work on; do not re-read cards the set does not point
at.

**After compaction.** The hook prints `working.md` under the summary (MCP-only clients:
call `working_list` first thing). Working memory is authoritative for **structure**: which
items exist, what is in flight, what waits on the user. The summary is authoritative for
the **conversation**: the user's last message, what was just said. Where they disagree
about state, verify before acting — `git worktree list`, `git log -1` on the branches in
TASK lines, the running-agents list. Then `working_list { log: "today" }` once for what
happened since the header's `updated` time. Do not re-derive anything the set records.

**During work.** Write when state actually changes, in the same turn it happens: a goal met
or a plan step finished (tick the P line; drop the G when delivered), a dispatch that holds
a worktree or branch (new T line), a merge (drop T, log the commit), a decision (D line), a
user rule (C line, verbatim), a step blocked on the user (Q line). A research or
verification agent returning with nothing changed is not a state change; do not touch the
file for it. If you would put it in a compaction summary, put it in working memory now —
you do not know when compaction will fire. Batch with `items: [...]`.

**Sub-agents.** Worktrees do not carry gitignored files, but the tools resolve to the main
checkout, so agents may call `working_log` and `working_list` from anywhere. Put the
relevant C lines and the agent's T line verbatim in its brief; do not expect it to read the
set. Agents log when they finish, dispatch, or hit something the orchestrator must know.
They never call `working_set` or `working_drop`.

**Promotion and expiry.** A DECISION that outlives the stretch becomes a DECISION card via
`create_card`, then is dropped here. An IDEA that becomes work becomes a TASK or a FEATURE
card. When a goal is delivered, drop it and its plan. By the end of a stretch the set should
be empty apart from long-lived CONSTRAINT lines.

## The types

Each type answers one question. Before creating an item, ask its question. Before keeping
one, ask its keep test. Ends means drop, with a reason.

**GOAL** — what outcome is the user after right now?
- Create when the user asks for a concrete thing to make, decide, or find out.
- Ask: can I name the finished result? Would I know when it is delivered?
- Keep: still undelivered, and the user still wants it.
- Ends: delivered, or the user drops it.

**PLAN** — in what order will the current work get done?
- Create for multi-step work that spans turns. One line: `✓` on done steps, `→` before
  the next.
- Ask: are there at least three real steps? Does the order matter?
- Keep: open steps the user still wants done.
- Ends: every step done; replace it when the approach changes.

**FOCUS** — which step are we on right now?
- One line, replaced not appended; setting a new F drops the old one.
- Ask: is this a step inside a live goal, not a new outcome?
- Keep: still the step being worked on this turn.
- Ends: the moment work moves to the next step.

**TASK** — what single piece of in-flight or pending work must not be lost?
- For an orchestrator this is mostly dispatched work: worktree, branch, head, holder, and
  the next step (`→ review`, `→ merge`). Also a thing to check or read later.
- Ask: is it one concrete item that would get lost if not written down?
- Keep: undone and still needed.
- Ends: merged or done, or no longer needed.

**CONSTRAINT** — what rule must every answer obey?
- Create only for rules the user stated ("must", "never", "keep", "don't"). Quote them
  verbatim; the paraphrase is where meaning drifts.
- Ask: did the user say this, or am I inventing a rule? Is it for this goal or all work?
- Keep: the user has not changed it, and the work it governs is live.
- Ends: with its goal if it only governed that goal. General rules stay.

**DECISION** — what has already been chosen, so it is not reopened or contradicted?
- Create when a choice was made between real options. One line: what was chosen, and the
  reason if it matters. A decision is not a constraint: a constraint is a rule the user
  imposed; a decision is the outcome of choosing.
- Ask: were there alternatives? Would a later answer plausibly drift from this or
  re-argue it?
- Keep: still steers work that is live or coming next.
- Ends: superseded, or the work it governed is finished and nothing depends on it. If it
  outlives the stretch, promote it to a DECISION card first.

**QUESTION** — what must the user answer or do before a choice can be made?
- Create when the answer changes what gets built and a sensible default will not do.
  Keep these separate from things waiting on agents.
- Ask: will the answer change the work? Could I settle it myself instead?
- Keep: still unanswered and still blocking.
- Ends: answered — record the answer as a D or C line if it governs later work — or moot.

**IDEA** — what worthwhile alternative should we keep in mind for later?
- Create for an approach worth returning to, not every variation.
- Ask: would the user plausibly revisit this? Is it distinct from the current path?
- Keep: still a live option.
- Ends: adopted (becomes a D line, or a TASK / FEATURE card) or rejected, with a few words
  why.

## Keep every line short

The whole set is re-read after every compaction and by every agent that calls `orient`, so
each character costs tokens for the rest of the stretch. A line is a headline, not a
sentence: aim under 100 characters, hard ceiling 160. Fragments, not prose. Identifiers,
not descriptions: a handle, a branch, a sha, an agent id, an arrow to the next step. Never
restate what a linked card already says; link it. No history in a line — that is the log.
No hedging, no rationale beyond a few words after a dash.

Good: `T12 [4] Stripe webhook — wt stripe-webhook, 148846a, opus a2c1 → merge`
Bad: `T12 [4] The Stripe webhook work is being done by an Opus agent in the stripe-webhook
worktree and once it finishes we need to review and merge it`

## Done means deleted

There is no "done" state. The moment a goal is delivered, a plan's last step is ticked, a
task is merged, a question is answered, or an idea is adopted or rejected, `working_drop`
it with a one-line reason, in that same turn. Do not leave it for the sweep, do not mark it
`✓` and keep it, do not rewrite it as "done: …". The reason lands in the log; the line
leaves the file. By the end of a stretch the set should be empty except for long-lived
constraints; a full set at the end means items were not dropped, not that a lot was
achieved.

## Keep the set clean

Every live item is text you read again after every compaction. Sweep the set at session
start, after compaction, and whenever you close work: run each keep test and drop what
fails. Close what you finished in the same turn the work lands, not later. An answered
question is a dropped question; never rewrite a line to report its own status. Never add an
item for something already there; update that item instead. When unsure about a
user-stated constraint, keep it. When unsure about anything else, ask whether its absence
would change the next action; if not, drop it. More than about 25 live items is a signal,
not an achievement.

## Cards vs working memory

Never write a card fact (an endpoint's behaviour, a table's shape, a rejected architecture)
into working memory, and never write session state (an agent id, a worktree path, tonight's
next step) into a card. When something in the set turns out to be durable, promote it with
`create_card` or `append_note`, then drop it here.
