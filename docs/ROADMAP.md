# Roadmap

Agent Office is developed in public. The direction is human. Most small changes are
implemented by free models against the queue below, checked by the repository's tests and
build, and committed with the commands that were actually run. A change that fails its
check is reverted, not patched until it looks green.

## Rules for every item

1. One item per run, at most five files.
2. `bun test`, `bun run build`, `bun run check` must pass, and the built bundles must match
   their sources (`git status --short` empty after a build).
3. The commit names the item and the checks that ran. No paid model, no hosted service, no
   publishing outside this repository.
4. A behaviour change needs a test that fails before it and passes after it. A UI change
   needs the browser suite, not a claim.
5. An item must be provable without pushing. A job that only runs in CI is written in the
   same pass but is proven by the next push, and is not called done before that.

## Now

### 1. The service smoke test never runs
`tests/service-smoke.mjs` starts the built service and checks authentication and invalid
routes, but `bun test` only discovers `*.test.*`, so it has never run in CI. Make it
discoverable and keep it exercising `service/main.js`, not a mock.

**Done when:** `bun test` includes it, it passes, and the full suite still passes.

**DONE** — 4ac28db. `bun test` now reports 146 pass across 12 files, including the
smoke test, and the original undiscovered file is gone.

### 2. The browser suite never runs
`tests/panel.test.mjs` skips every panel test when Playwright is absent, and nothing installs
it, so the whole UI is untested locally and on every push.

**Done when:** a documented command installs Chromium and runs the panel suite, the suite
passes, and a deliberate break in `panel/main.ts` makes it fail. The CI job is added in the
same pass; it counts as done only after a push proves it.

### 3. Controls that do nothing are shown as if they work
`panel/main.ts` renders `language` and `notifications` inputs while the same file admits
localization and notification delivery are not implemented. A user can set them and see no
effect.

**Done when:** the form only offers settings that are read somewhere, or an unimplemented
setting is visibly marked as stored-but-inactive; a test asserts the form cannot present an
inactive control as working.

### 4. One corrupt settings file stops discovery
`shared/settings.mjs` aborts the whole discovery on any error other than a missing file, so
one unreadable layer hides every other layer.

**Done when:** a corrupt layer is reported as a source error and the remaining layers are
still discovered; covered by a test.

### 5. An uncertain dispatch blocks the project with no way out
`shared/dispatch.mjs` marks a delivery uncertain and then refuses further dispatch, but the
panel offers no way to resolve it.

**Done when:** the panel shows the uncertain delivery and offers two explicit resolutions
(confirmed delivered / failed, retry allowed), each recorded; covered by a test.

### 6. A server override skips the local-service checks
`shared/host.mjs` lets `AGENT_OFFICE_SERVER` or `OPENCODE_HOST` bypass the loopback and
service-token checks that otherwise guard dispatch.

**Done when:** an override either keeps the same checks or requires an explicit trusted flag
that is documented; covered by a test.

### 7. The terminal preview is not exercised end to end
The README tells users to run the companion from the installed extension directory. No test
runs that exact path.

**Done when:** a test runs the documented command from a project directory and asserts the
preview output; the README command is the one under test.

## Owner decisions

- **Name.** Five other GitHub projects are called Agent Office or close to it, all a
  cartoon-office metaphor. The name buries this project in search. Renaming is a product
  decision, not a code change.
- **Publishing.** This repository is the only distribution channel. No package registry, no
  hosted service, no telemetry.

## Not planned

- A hosted backend, accounts, or telemetry.
- Owning or spawning agents. Agent Office observes the host's sessions and dispatches
  explicitly; it is not another orchestrator.
- Paid models as a requirement. Any model the host already has may be used, but nothing here
  needs a paid key.
