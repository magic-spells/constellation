---
name: v1.0.1 — MCP review fixes
status: building
version: 1.0.1
connections:
  - RELEASE-V1-0-0
  - FILE-MCP-SERVER
  - FILE-WRITER
  - FILE-GIT
  - DOC-MCP-SERVER
---


Theme: close the agent-facing holes found reviewing 1.0.0.

A review pass over the MCP surface after [[RELEASE-V1-0-0]] shipped. No new features — every change is a case where a tool lied to the agent calling it: a guard that could be raced, a byte charge for content that was never sent, a crash on a typo'd handle, a write that landed and reported nothing.

## Upgrade notes

Patch. One narrowed return field.

- **`delete_card.referenced_by` now returns only the structured referrers** — the cards whose `connections`/frontmatter point at the deleted handle and will therefore raise E005 — instead of the full undirected neighbour set. A one-sided edge declared only on the deleted card no longer appears. This is the set the skill always described; the code was the outlier.
- **`if_mtime` is checked inside the write lock.** Two callers sampling the same mtime could both pass the guard and both write, the later silently clobbering the earlier.
- **Hydration charges only the notes it returns.** A card with a long note history was degraded to a summary over bytes that were sliced off before sending; kind-filtered requests were charged for other kinds too.
- **`plan_log` on an unknown prefix** raised an uncaught error; a typo'd valid-prefix handle returned `commits: []`, indistinguishable from "never committed". Both now report, with `in_plan`.
- **`add_connection(X, X)`** wrote a YAML entry the graph drops and nothing cleans up. Now a no-op.
- **An unreachable connected repo** reported `UNKNOWN_REPO` listing the name you just passed. Now `UNREACHABLE_REPO`, naming the declared path.
- **A half-made reciprocal repo link** turned the whole call into `INTERNAL`. Now reports `reciprocated: { ok: false, reason }`.
