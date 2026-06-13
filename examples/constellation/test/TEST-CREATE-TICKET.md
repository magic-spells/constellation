---
name: Create ticket — integration
kind: integration
status: verified
framework: vitest
connections:
  - API-TICKETS
  - FLOW-CREATE-TICKET
---

# Create ticket integration test

Covers the full [[FLOW-CREATE-TICKET]] happy path plus the 422 branch:

- valid input → 201, row in [[DB-TICKETS]], event emitted
- missing subject → 422, no row, no event
- duplicate delivery of the created event → no double-assignment
