---
name: working
description: Show or edit the session's Constellation working memory (.constellation/working.md) in the chat. Invoked by the user as /working, optionally followed by an instruction such as "drop T12" or "add task ...".
disable-model-invocation: true
allowed-tools: Bash(npx --no-install constellation working:*)
---

# /working

The current working-memory set, read from disk just now:

!`npx --no-install constellation working 2>/dev/null || echo "(no .constellation/ folder here — call working_init to create one)"`

**No argument** (`/working`): print the block above verbatim in a fenced code block. Nothing
else: no commentary, no suggestions, no summary. Do not call any tool.

**With an argument** (`/working drop T12`, `/working add task Stripe webhook — wt
stripe-webhook, 148846a → merge`, `/working G1 is done`, `/working sweep`): apply it with
`working_set` or `working_drop`, then print the updated set the same way from the tool's
result. `sweep` means run every item's keep test and drop what fails, listing what was
dropped and why in one line each above the set. Plain English is fine; infer the type and
the ID from the words. Rules for the set are in the `constellation` skill's
`working-memory.md`.

The set belongs to the orchestrator: a sub-agent asked to run this shows the set but does
not edit it.

For an instant print with no model turn at all: `! npx constellation working`.
