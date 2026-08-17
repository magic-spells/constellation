---
name: v0.6.0 — reading the plan
status: planned
version: 0.6.0
---


Theme: a plan you can **read**, not just author.

Everything so far has served writing and querying cards. This release serves the
other direction — turning the same files into something a person sits down with.
[[FEATURE-DOC-SECTIONS]] compiles them into one ordered document you can print;
[[FEATURE-ARCHITECTURE-ATLAS]] renders them as a place you can walk through. Two
readings of the same graph, macro and linear.

Two viewer fixes ride along because they are cheap and in the way:
[[FEATURE-VERIFIED-RECENCY-CAP]] and [[FEATURE-TOPBAR-GITHUB-CORNER]].

## Upgrade notes

Additive only. `section:`/`order:` on cards and `doc_sections:` on
`PLAN-PROJECT` are optional — a plan that sets none of them has no `/docs`
document and is otherwise unchanged.
