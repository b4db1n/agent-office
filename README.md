# Office Steward

Office Steward shows the people and processes behind a coding task: the selected lead, its actual child sessions, who needs an answer, and which work has a result. Use your existing OpenCode provider and models. No Office account or hosted service is required.

## Install from GitHub

[Install Office Steward](openchamber://extensions/install?url=https%3A%2F%2Fgithub.com%2Fb4db1n%2Foffice-steward)

This opens OpenChamber's install confirmation for the GitHub repository. If the link does not open, paste `openchamber://extensions/install?url=https://github.com/b4db1n/office-steward` into an OpenChamber chat and open the link there. **Skip “Add from folder.”** No local file or folder is needed.

After installing, enable **Office Steward** in **Work Status → Panel Sections**.

## Start here

1. Open a project. Before configuration, the compact **Work Status** section reads **Setup required** and offers **Copy setup prompt**; paste it into a project chat, or use the [getting-started guide](docs/GETTING-STARTED.md#the-chat-prompt). Once configured, find the same prompt under **Settings → Revisit setup**.
2. Review the existing agents, model rates and exact proposed changes. Any visible primary agent can lead. Approve the project choices once, then check the repeated preview until the saved result is unchanged.
3. When configured, the compact section shows the chosen lead, the effective model and its source, plus a live **Current work** list. It reads **Setup preview pending** while unsaved Settings edits wait. **Ask Office lead** appears there only when the status is **Ready** with no pending preview and no task being composed.
4. For a first task, try: “Delegate a small change to the selected specialist. Add a `double` function and a check that `double(4)` returns `8`. Run the check yourself and report its result.” Open a person in the Office to inspect the actual child session.
5. **Ask Office lead** has two entry points: that **Ready** button and the action on the menu of **your own message** in a chat. Both explicitly dispatch a new lead root; neither is an `@` attachment. **Talk** only opens an existing session in OpenChamber; it never sends a message or answers a permission request. A specialist model is a preference, not a guarantee: Settings shows the requested lead model; a model on an assistant message is the host's **observed route**, not a billing receipt. **Completed** means the host reported completion — no reply, artifact or verified result is guaranteed; check with a local test. “Host default” does not mean free.
6. **Settings** only offers controls that change behaviour. `language`, `appearance`, `notifications` and `visibleControls` are stored for compatibility but nothing reads them yet, so they appear disabled in a **Stored, not used yet** block and are never sent when you apply changes.

## Departments and the advisor

Departments organize agents that already exist in your project. A department has a name, a purpose, a lead and its members. The Office never creates, spawns or owns an agent; a department without an available lead is reported as needing attention, never silently swapped.

Set an **advisor** in **Settings → Office structure**, then add the departments you want. From a department card you can:

- **Ask** the department: the task goes to that department's lead, and the prompt carries the team and what it learned. The lead, model and department are recorded in the Office ledger.
- **Advisor review**: the advisor reads the department's finished Office work — host-reported outcomes, labelled as such — and answers with up to three `LESSON:` lines.
- **Collect lessons**: the Office stores only those explicit lines, with the advisor session as their source, and adds them to that department's next task.

Lessons are advice, not verified facts. They live in Office state (`~/.config/agent-office/lessons.json`), are capped at 20 per department, and nothing edits an agent definition on its own. Completion is still a host outcome; a lesson never upgrades it to a verified result.

## Status and limits

The compact section can also read **Checking**, **Degraded** (agent/model discovery or live session coverage is unavailable), or **Needs attention** (the selected lead or model is unavailable, a finite budget blocks dispatch, parallelism is zero, a delivery is pending or uncertain, or a session shows failed/waiting/unknown status). Refresh after fixing the cause; a degraded or uncertain reading is not permission to retry blindly. Cost is a host-reported figure or an estimate from assistant messages, not a billing receipt: partial and no-data readings stay labeled and unknown counts stay unknown; a request or selection is not an observed route. Verification is yours — **Completed** only reports host completion and needs a local check.

## Terminal preview

With Office Steward installed from the GitHub release and OpenCode 2 already running, run this from **your project**. It previews optional files without downloading or starting anything:

```sh
(d="$HOME/.config/openchamber/extensions/agent-office"; test -f "$d/shared/family.mjs" && node "$d/companion/setup.mjs" --templates --plugin)
```

See the [terminal guide](docs/GETTING-STARTED.md#terminal-preview) for how to apply only the files you want. Existing definitions are never overwritten, and setup does not change global OpenCode configuration.

## Permissions and scope

The extension requests session metadata to draw the Office and open the selected chat. Its local service invokes `opencode` to discover agents and models, store Office preferences, and dispatch explicitly requested work. Office Steward is a deterministic projection of confirmed session metadata scoped to the current project's Office team: refresh and replay rebuild the same records, nothing outside that scope is shown, and it never sends work or runs a model. The background message action only forwards the message you chose, and only when you invoke it; it never dispatches or spends on its own. The optional OpenCode plugin runs inside OpenCode. Office Steward does not need a provider key, a GitHub token, or access to every chat transcript from the OpenChamber panel.

Contribution suggestions start as editable synthetic examples. Cancel to discard. Opening the GitHub issue editor does not publish anything; GitHub's **Create** button is the final submission.

## Name and compatibility

This project was previously published as Agent Office. The extension id stays `agent-office`, and so do its state folders (`~/.config/agent-office`, `~/.local/share/agent-office`) and environment variable names, so existing installs and saved settings keep working. GitHub redirects the old repository URL, and the `agent-office` command remains an alias of `office-steward`.

## Development

```sh
bun install --frozen-lockfile
bun run build
bun test
bun run test:panel
bun run check
```

The extension loads the committed JavaScript bundles. When changing source, rebuild before installing or publishing. `bun test` runs the whole suite, including the Office interaction checks when Chromium is available. `bun run test:panel` installs Chromium once and runs only those checks; without the browser they skip with that command in the message. CI installs Chromium and sets `PANEL_REQUIRE_BROWSER=1`, so a missing browser fails the job instead of skipping it. The panel is a browser bundle: a module it imports must stay browser-safe, which is why the shared settings key list lives in `shared/setting-keys.mjs` and not in `shared/settings.mjs`, whose Node-only imports break every browser check without failing the build. Do not include runtime state, personal configuration, screenshots or transcripts in a contribution.
