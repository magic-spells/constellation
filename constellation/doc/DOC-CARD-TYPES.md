---
name: The 17 card types
kind: reference
status: built
---

# The 17 card types

The prefix before the first dash determines a card's type and must be one of these 17. Folder
placement matches the type (a misfiled card warns W001, not errors — the prefix is
authoritative). Defined in [[FILE-TYPES]] (`TYPE_NAMES`) and [[FILE-HANDLES]] (`TYPE_FOLDERS`).

| Type | Prefix | Folder | What it is |
|---|---|---|---|
| API | `API-` | `api/` | HTTP/RPC endpoints |
| DB | `DB-` | `db/` | Database tables / collections |
| DATATYPE | `DATATYPE-` | `datatype/` | Data type schemas (interfaces, Zod, etc.) |
| ROLE | `ROLE-` | `role/` | User roles / permission groups |
| DOC | `DOC-` | `doc/` | Documentation cards |
| FILE | `FILE-` | `file/` | Source file references (require `path`) |
| TEST | `TEST-` | `test/` | Test specs |
| EXTERNAL | `EXTERNAL-` | `external/` | External services / integrations |
| EVENT | `EVENT-` | `event/` | Domain events / signals |
| COMPONENT | `COMPONENT-` | `component/` | Reusable UI components |
| PAGE | `PAGE-` | `page/` | Frontend routes / screens |
| JOB | `JOB-` | `job/` | Background / scheduled / queued work |
| FLOW | `FLOW-` | `flow/` | Multi-step sequenced processes |
| STATE | `STATE-` | `state/` | State machines |
| DIAGRAM | `DIAGRAM-` | `diagram/` | Architecture diagrams |
| AGENT | `AGENT-` | `agent/` | AI agent instructions / policies |
| PLAN | `PLAN-` | `plan/` | Plan documents (`plan.md` = PLAN-PROJECT) |

**Adding or renaming a type touches four places that must agree:** `TYPE_NAMES`
([[FILE-TYPES]]) + `TYPE_FOLDERS` ([[FILE-HANDLES]]); `schemas/<folder>.json`;
`skill/types/<folder>.md`; and a sample card in `examples/` + this table. Each type's
frontmatter schema + golden example is served live by the MCP `describe_type` tool.
