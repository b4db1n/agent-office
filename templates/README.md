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

OpenCode 2 applies ordered `permissions`; the last match wins. Reviewer and
implementer deny unlisted tools (including delegation and MCP). Before using
the implementer to write, the project owner appends exact ownership rules to
their installed copy, for example `{ action: edit, resource: src/math.mjs, effect: allow }`.
The lead runs checks by default; shell access is not a filesystem sandbox.
Review custom rules before adopting them. The installer never upgrades an
existing project definition in place. The built-in Steward is a projection of
session metadata; it needs neither a template nor a model.
