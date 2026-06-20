---
name: Connected repos (multi-repo)
kind: spec
status: built
---

# Connected repos (multi-repo)

A project spanning several repos declares its siblings on PLAN-PROJECT — the one cross-repo
concept in the format, deliberately minimal. Each repo's `constellation/` is a standalone plan,
references only its own cards, and lints clean alone; **connections never cross repos.**

```yaml
# plan.md frontmatter
connected_repos:
  - name: pyramid-server     # the `repo` selector (lowercase id)
    path: ../pyramid-server  # relative to this repo's root (or absolute)
    description: Back-end API for Pyramid.
```

Paths are local topology and are **never linted** — reachability is computed at call time.
[[FILE-REPOS]] resolves the `repo` selector; every MCP read/write tool accepts it to target a
sibling. **Plan resolution still never crosses a repo boundary** on its own ([[FILE-RESOLVE]])
— a sibling is reached only when explicitly named. Management tools: `list_connected_repos`,
`add_connected_repo` (`reciprocate` writes the reverse link too), `remove_connected_repo`.
