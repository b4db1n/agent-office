# Agent Office

Agent Office shows the people and processes behind a coding task: the selected lead, its actual child sessions, who needs an answer, and which work has a result. Use your existing OpenCode provider and models. No Office account or hosted service is required.

[Install Agent Office](openchamber://extensions/install?url=https%3A%2F%2Fgithub.com%2Fb4db1n%2Fagent-office)

## Start here

1. In OpenChamber **Settings → Extensions**, add this repository and review its permissions. Enable **Agent Office** in **Work Status → Panel Sections**.
2. Open a project. In the setup checklist, inspect the available agents and models. Pick a visible primary agent as lead. **There does not have to be an agent named `lead`.** If your saved choice disappeared, select another or preview a starter definition.
3. Open **Settings** from the section. Use a project override to select a lead and a lower-cost specialist model without changing other projects. “Host default” means the host chooses; it does not mean free.
4. Copy **Set up Agent Office in this project** from the panel and paste it into a project chat. Check the proposed paths before approving changes.
5. To dispatch from an existing chat, open the menu on **your own message** and choose **Ask Office lead**. This is a dispatch action, not an `@` attachment. Use **Talk** to open an existing session in the native chat; Talk does not send a message or answer a permission request for you.

For a first task, try: “Delegate a small change to the selected specialist. Add a `double` function and a check that `double(4)` returns `8`. Run the check yourself and report its result.” Open a character in the Office to inspect the actual child session.

## Terminal setup

Use OpenCode 2 and a recent Node.js with `opencode` on `PATH`. Clone the release once. From the **target project** (not the extension checkout), run:

```sh
# Set OFFICE to the path of your Agent Office checkout.
node "$OFFICE/companion/setup.mjs"
node "$OFFICE/companion/cli.mjs" inspect
```

Setup previews changes by default. Add `--templates` to preview the optional Lead, Implementer and Reviewer definitions. Add `--plugin` to preview the project-local OpenCode companion. Add `--apply` to perform those approved changes. Existing definitions stay yours. No global OpenCode configuration is required. The project-local plugin is useful when OpenChamber is not running.

## Permissions and scope

The extension requests session metadata to draw the Office and open the selected chat. Its local service invokes `opencode` to discover agents and models, store Office preferences, and dispatch explicitly requested work. The background message action receives the chosen user message. The optional OpenCode plugin runs inside OpenCode. Agent Office does not need a provider key, a GitHub token, or access to every chat transcript from the OpenChamber panel.

Contribution suggestions start as editable synthetic examples. Cancel to discard. Opening the GitHub issue editor does not publish anything; GitHub's **Create** button is the final submission.

## Development

```sh
bun install --frozen-lockfile
bun run build
bun test
bun run check
```

The extension loads the committed JavaScript bundles. When changing source, rebuild before installing or publishing. `bun test` runs the non-browser suite; the Office interaction checks need Playwright installed separately and `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --test tests/panel.test.mjs`. They skip when Playwright is unavailable. Do not include runtime state, personal configuration, screenshots or transcripts in a contribution.
