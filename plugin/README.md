# Agent Office OpenCode plugin (`/office`)

The server-side OpenCode plugin behind `/office`. It runs inside OpenCode with the host's access. No Office account, hosted service or separate service process is required. The shipped file is `plugin/index.js`; it is the built bundle of `plugin/source.ts`, which imports nothing at runtime.

## Install, copy, enable

Choose one of the two supported ways:

**1. OpenChamber extension (automatic).** In OpenChamber open **Settings → Extensions**, add this repository and review/approve its permissions, then make sure **Agent Office** is enabled. OpenChamber lists this `plugin/` folder in the OpenCode config it manages while the extension is enabled, and OpenCode loads it within a couple of seconds. No manual file copy is needed. To see the team and open the new session, also enable **Agent Office** under **Work Status → Panel Sections**.

**2. Project-local plugin (works without OpenChamber).** From the **target project** (not this checkout), set `OFFICE` to your Agent Office checkout and run:

```sh
node "$OFFICE/companion/setup.mjs" --apply --plugin
```

That copies exactly one file:

```
<target-project>/.opencode/plugins/agent-office/index.js
```

OpenCode discovers `.opencode/plugins/` automatically, so the plugin is enabled as soon as the file is there. If it is not picked up, run `opencode service restart`, or add `".opencode/plugins/agent-office"` to `plugins` in the project's `opencode.json(c)`. To disable it, remove the copied folder, or add `"-agent-office"` to `plugins`.

After editing `plugin/source.ts`, rebuild the file that is actually loaded:

```sh
bun build plugin/source.ts --target=node --format=esm --outfile=plugin/index.js
```

Keep the built entry free of runtime imports.

## What `/office` does

Type `/office <task>` in any chat in a project that has a selected Office lead. The command:

- sends `<task>` to a **new root session** for the configured lead, using the configured lead model and the project's budget/parallelism settings;
- does **not** add the task to the chat you typed it in;
- posts a short note in the invoking chat with the new **session ID**, lead and model. That note is a synthetic message with `resume: false`: it is visible in the transcript but is never sent to a model, so command output is not auto-promoted into a prompt.

The delivery mode (`steer` / `queue`) is accepted, but the task always goes to the new session, never back to the invoking one.

## Does it open the UI?

**No.** The plugin runs inside the OpenCode server and cannot switch the OpenChamber screen or the terminal UI to the new chat. It creates the root session and reports its ID so you can follow it yourself: open it from the **Agent Office** panel section, from the session list, or with OpenChamber's **openSession(id)**. The **Ask Office lead** message action is a separate OpenChamber feature; it also dispatches a root but is not this command.
