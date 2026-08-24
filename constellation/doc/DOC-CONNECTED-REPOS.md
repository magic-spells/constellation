---
name: Connected repos (multi-repo)
kind: spec
status: built
connections:
  - FILE-REPOS
  - FILE-RESOLVE
section: format
order: 50
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
They resolve against the directory holding `constellation/`, never against PLAN-PROJECT's
`code_root`: that field relocates where *this* plan's code lives and says nothing about where
siblings sit ([[DECISION-MONOREPO-CODE-ROOT]]).
[[FILE-REPOS]] resolves the `repo` selector; every MCP read/write tool accepts it to target a
sibling. **Plan resolution still never crosses a repo boundary** on its own ([[FILE-RESOLVE]])
— a sibling is reached only when explicitly named. Management tools: `list_connected_repos`,
`add_connected_repo` (`reciprocate` writes the reverse link too), `remove_connected_repo`.

The same mechanism also routes *inside* one repo: a monorepo root carries a signpost `plan.md`
whose `connected_repos` names the package plans, so `repo:` reaches a package without a full
plan ever existing at the root. "Sibling repo" is the common case, not the limit.
