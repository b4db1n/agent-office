# Getting started with Office Steward

## Install in OpenChamber (GitHub, no local file selection)

Click **Install Office Steward** in the [README](../README.md). If your browser will not open it, paste `openchamber://extensions/install?url=https://github.com/b4db1n/office-steward` into an OpenChamber chat and open the link there. OpenChamber asks before installing from GitHub. Skip **Add from folder**.

Then enable **Office Steward** in **Work Status → Panel Sections** and open a project. Before configuration the compact **Work Status** section reads **Setup required** and offers **Copy setup prompt**; after configuration, open **Settings → Revisit setup** for the same prompt. Review an available lead, specialist preference and costs together before approving anything.

## The chat prompt

Use **Copy setup prompt** from Work Status (unconfigured) or **Settings → Revisit setup** (configured), or copy the text below. The agent finds the companion and stops after previewing until you approve the changes.

```text
Set up Office Steward in this project. Work from the current project directory. Do not ask me to choose a file or folder at any step.

0. PREREQUISITES AND COMPANION
   - Check that `node` and `opencode` (OpenCode 2) are on PATH. If either is missing, state that prerequisite and stop before any write.
   - Find the installed companion yourself: resolve `command -v office-steward`, or check `~/.config/openchamber/extensions/agent-office` and `~/.local/share/agent-office/checkout` for `companion/setup.mjs`. Verify the package name and Git origin. Do not search unrelated project folders.
   - If missing, stop at the GitHub install link: https://github.com/b4db1n/office-steward. Do not clone or install on my behalf. If only the old companion without shared/family.mjs is present, stop: its inspect may create a chat.

1. DISCOVERY (read only)
   - Run the companion CLI `inspect` from this directory. If OpenCode has not loaded the project, tell me how to retry without creating a disposable chat.
   - Record the exact lead id and candidate ids with their mode and hidden flags, the exact model ids from the host catalog, and the current Office settings with their sources. Quote ids as reported; never rename or substitute one.
   - Inspect existing project definitions and plugin paths and report what already exists, so nothing is duplicated or overwritten.
   - If no lead is selected or its id is missing/hidden, list the observed candidates and ask me to pick one, or offer to preview a starter lead. Never silently substitute another agent.

2. PREVIEW (no writes)
   - Run the companion setup with `--templates --plugin` and without `--apply`. Show exact target paths, skipped existing definitions, the observed lead id, and the observed lower-cost specialist model ids from the catalog.
   - Ask me to confirm the lead and specialist model, or to explicitly keep the host default. Stop here until I approve the complete set of changes. No file may be written before that approval.

3. SETUP (only after complete approval, idempotent)
   - Apply only the approved project settings and missing optional files. Include the optional templates and/or project-local plugin only if I approved those pieces.
   - Use exclusive create: never overwrite an existing definition, never replace a host-provided agent, never change global defaults.
   - Preview again and verify existing definitions are unchanged and no duplicates were added. Persist the lead id exactly as validated. Re-running must produce the same result.

4. SMOKE (safe, no paid models)
   - Dispatch one small agreed task only with model ids I have confirmed are free for this session. If no free model is confirmed, skip the smoke and say why; never run a model of unknown or paid cost.
   - Have the lead verify the result with a local check (a new file or an assertion). Inspect the team under that root and report the actual parent/child relationship, the observed lead and models, and the verification result. Distinguish missing evidence from success.
   - Report the files touched and the checks run. Do not commit unless explicitly asked.
```

The prompt deliberately records exact ids rather than inventing them. The smoke step uses only models you have confirmed are free; if none is confirmed, it skips the smoke instead of spending money. You can return to this prompt any time from **Settings → Revisit setup**. **Completed** only means the host reported completion; no reply, artifact or verified result is guaranteed — confirm with a local check.

## Terminal preview

With Node.js, the current companion installed and OpenCode 2 running, run this from **your project**. It does not download anything, change the project, or launch a service. If the companion is missing, use the GitHub install link above.

```sh
(d="$HOME/.config/openchamber/extensions/agent-office"; test -f "$d/shared/family.mjs" && node "$d/companion/setup.mjs" --templates --plugin)
```

The companion's `--help` output (the same text printed by `node companion/setup.mjs --help` from the installed companion) is:

```text
Office Steward setup - preview by default; no project changes without --apply.

From the target project, preview with one command:
(d="$HOME/.config/openchamber/extensions/agent-office"; test -f "$d/shared/family.mjs" && node "$d/companion/setup.mjs" --templates --plugin)

Companion options (node <checkout>/companion/setup.mjs):
  (none)          Preview only: paths, observed lead, models, skipped files.
  --apply         Perform only the approved changes (exclusive create).
  --templates     Include the optional lead/implementer/reviewer definitions.
  --plugin        Include the optional project-local OpenCode plugin.
  --lead ID       Check a candidate lead; does not save your choice.
  --help, -h      Show this help.

Prerequisites: Node.js and OpenCode 2 (`opencode` on PATH).
Install in OpenChamber from https://github.com/b4db1n/office-steward; no local file selection is needed.
```

Preview only the optional groups you want (`--plugin` and/or `--templates`). Recheck the preview before applying the same options with `--apply`. Existing and host-provided definitions are skipped. The default desktop path needs neither group.

## Dispatch and costs

**Ask Office lead** has two entry points: the button in the compact Work Status section, shown only while the status is **Ready** with no pending Settings preview and no task being composed, and the **Ask Office lead** action on the menu of **your own message** in a chat. Both explicitly create one new lead root and link the source message as metadata; neither is an `@` attachment. **Talk** opens an existing session in OpenChamber; copy the draft and send it yourself — Talk never sends a message or answers a permission request. Terminal `team ROOT` shows session selections and waiting requests; `cost ROOT` shows models observed in assistant messages. `stop SESSION --root ROOT` verifies membership before interrupting. A failed waiting-state read is unknown, not an invitation to send.

The compact section reads **Setup required** before configuration (with **Copy setup prompt**), then shows the chosen lead, the effective model and its source, and the **Current work** list. It can also read **Checking**, **Degraded** (discovery or live session coverage unavailable), **Needs attention** (unavailable lead/model, finite budget, zero parallelism, or a pending/uncertain delivery), and **Ready**. The Steward is a deterministic projection of confirmed session metadata scoped to this project's Office team: refresh and replay rebuild the same records, nothing outside that scope is shown, and it never sends work or runs a model. No background action spends on its own — the message action only forwards the message you chose, and only when you invoke it. **Completed** only means the host reported completion; it guarantees no reply, artifact or verified result — verify with a local check.

The model shown in Settings or the compact section is the **requested/effective** lead model; a model on an assistant message is the host's **observed route**, not a billing receipt. Parallelism counts active Office reservations for the current project, including pending or uncertain delivery; zero pauses dispatch. A reservation lasts from admission until the root and its descendants have terminal outcomes. Estimates are not spending. Null budget means no Office admission limit, blank inherits, and zero is a real limit. On OpenCode 2.3.2 a finite budget blocks delegation: the host cannot cap child routes or their cost. No setting is a provider billing cap. If delivery is uncertain, inspect the session before retrying.

Cost covers assistant messages in the selected family, not an account balance or an invoice; an observed route is not a charge. Host-reported zero is a measurement; no messages means no usage observed. Estimates stay estimates at exact provider/model rates; unknown and partial results stay labeled. Neither a requested model nor a session selection proves that model ran.
