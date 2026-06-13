---
name: Ticketing Example
---

# Project Plan

A minimal support-ticket app used as the golden example for the Constellation v2
format. One card of every type, fully connected.

## Current state

- Core ticket loop is specced: [[FLOW-CREATE-TICKET]], [[STATE-TICKET]],
  [[API-TICKETS]], [[DB-TICKETS]].
- Auto-assignment ([[JOB-AUTO-ASSIGN]]) is planned but not built.

## Conventions

- All ticket payloads use [[DATATYPE-TICKET]]; never inline ticket shapes.
- Email goes through [[EXTERNAL-EMAIL-PROVIDER]] only.

## Last synced

Code was last reconciled against plan commit `<sha>` (maintained by the sync agent).
