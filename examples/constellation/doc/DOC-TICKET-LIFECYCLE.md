---
name: How tickets move through the system
kind: guide
status: built
---

# Ticket lifecycle

A ticket is born when the public form posts to [[API-TICKETS]] — the whole
sequence is [[FLOW-CREATE-TICKET]]. From there it walks the state machine in
[[STATE-TICKET]]: `open → assigned → resolved → closed`, with one loop back when
a requester reopens.

Two invariants the code must never break:

1. State transitions happen only in the API layer. Nothing writes the `status`
   column directly.
2. Every state change that matters to the requester produces an email through
   [[EXTERNAL-EMAIL-PROVIDER]] — silence is a bug.

Assignment is asynchronous: [[EVENT-TICKET-CREATED]] decouples intake from
[[JOB-AUTO-ASSIGN]] so a slow assignment never blocks the requester's submit.
