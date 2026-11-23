# Agent templates

These are **optional, generic** agent definitions written in English. They are
starting points, not requirements: copy the ones you need into a project's agent
folder and adapt names, tools and boundaries to that project.

| Template | Role | Intended mode |
| --- | --- | --- |
| `lead.md` | Coordinate, delegate and verify | primary (top level) |
| `implementer.md` | Do the concrete work | subagent |
| `reviewer.md` | Independent check of a change | subagent |

Each template documents four things so an agent's job stays legible:

- **Triggers** — when the agent should be used.
- **Tools** — what it may use, and why.
- **Boundaries** — what it must not do.
- **Evidence** — the proof it must leave behind.

They are deliberately tool-agnostic. The `setup` prompt copies them and only
renames where the user explicitly asks.
