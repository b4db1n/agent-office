/**
 * Agent Office — shared setup helpers.
 *
 * Dependency-free and side-effect free, so this can be imported by service
 * code, panel code, or a one-off Node/Bun script. Nothing here mutates its
 * inputs and nothing here performs I/O.
 */

/** Stable, machine-readable next-action values returned by selectLead. */
export const LEAD_NEXT_ACTION = Object.freeze({
  READY: 'ready',
  CHOOSE_LEAD: 'choose-lead',
  NO_CANDIDATES: 'no-candidates',
});

/**
 * Agent modes allowed to act as a top-level lead. "primary" and "all" can be
 * started from the top level; "subagent" cannot. An absent mode is treated as
 * primary (the common default in agent configs).
 */
const PRIMARY_MODES = new Set(['primary', 'all', undefined, null, '']);

/** Coerce an id-like value to a trimmed string, or null. */
function normalizeId(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (value && typeof value === 'object') {
    // Tolerate being handed an agent object instead of its id.
    return normalizeId(value.id ?? value.name ?? value.key ?? value.agent);
  }
  return null;
}

/**
 * Normalize the many shapes agents arrive in into a flat [{ id, agent }] list.
 * Accepts an array of agent objects, an array of id strings, or an id-keyed map
 * (the `agent` object shape used by opencode.json).
 */
function normalizeAgents(agents) {
  if (!agents || typeof agents !== 'object') return [];

  const entries = Array.isArray(agents)
    ? agents.map((agent) => [normalizeId(agent), agent])
    : Object.entries(agents).map(([key, agent]) => [normalizeId(key) ?? normalizeId(agent), agent]);

  const seen = new Set();
  const result = [];
  for (const [id, agent] of entries) {
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, agent: agent && typeof agent === 'object' ? agent : {} });
  }
  return result;
}

/** Hidden and subagent-only agents are not valid lead candidates. */
export function isLeadCandidate(agent) {
  const record = agent && typeof agent === 'object' ? agent : {};
  if (record.hidden === true) return false;
  if (record.subagentOnly === true || record.subagent === true) return false;
  if (record.mode !== undefined && !PRIMARY_MODES.has(record.mode)) return false;
  return true;
}

/**
 * Resolve a lead selection without ever inventing a replacement.
 *
 * Pure: does not mutate `agents` or `selected`, performs no I/O, and is fully
 * determined by its arguments. Only an explicitly requested id that is also
 * present in `available` is honoured; a missing, hidden, or subagent-only
 * request is reported as unresolved rather than silently swapped for another.
 *
 * @param {Array|Object} agents  agent definitions (array or id-keyed map)
 * @param {string|null}  selected the requested / previously configured lead id
 * @returns {{selected: string|null, available: string[], nextAction: string}}
 */
export function selectLead(agents, selected) {
  const candidates = normalizeAgents(agents);
  const available = candidates
    .filter((entry) => isLeadCandidate(entry.agent))
    .map((entry) => entry.id);
  const requested = normalizeId(selected);

  // Only an explicit request that is genuinely available is honoured.
  if (requested !== null && available.includes(requested)) {
    return { selected: requested, available, nextAction: LEAD_NEXT_ACTION.READY };
  }

  // The requested lead is missing/hidden/subagent-only — never substitute it.
  if (available.length === 0) {
    return { selected: null, available, nextAction: LEAD_NEXT_ACTION.NO_CANDIDATES };
  }
  return { selected: null, available, nextAction: LEAD_NEXT_ACTION.CHOOSE_LEAD };
}

/** Public install source. The README deep link carries the same https URL. */
export const OFFICE_REPO_URL = 'https://github.com/b4db1n/agent-office';

/**
 * One copyable terminal command for a preview, run from the target project.
 * Uses $HOME (macOS and Linux), needs no placeholder the user must fill in and
 * never pipes a remote download into a shell. An existing clone is reused.
 */
export const PREVIEW_COMMAND =
  '(d="$HOME/.config/openchamber/extensions/agent-office"; test -f "$d/shared/family.mjs" && node "$d/companion/setup.mjs" --templates --plugin)';

/** Companion help, mirrored verbatim in docs/GETTING-STARTED.md. */
export const SETUP_HELP = [
  'Agent Office setup - preview by default; no project changes without --apply.',
  '',
  'From the target project, preview with one command:',
  PREVIEW_COMMAND,
  '',
  'Companion options (node <checkout>/companion/setup.mjs):',
  '  (none)          Preview only: paths, observed lead, models, skipped files.',
  '  --apply         Perform only the approved changes (exclusive create).',
  '  --templates     Include the optional lead/implementer/reviewer definitions.',
  '  --plugin        Include the optional project-local OpenCode plugin.',
  '  --lead ID       Check a candidate lead; does not save your choice.',
  '  --help, -h      Show this help.',
  '',
  'Prerequisites: Node.js and OpenCode 2 (`opencode` on PATH).',
  `Install in OpenChamber from ${OFFICE_REPO_URL}; no local file selection is needed.`,
].join('\n');

/**
 * Prompt that drives an idempotent Agent Office setup: discovery, preview,
 * setup, smoke. Safe to paste into a fresh session that owns the project.
 * It locates the companion itself and never asks the user to pick a file.
 */
export const SETUP_PROMPT = [
  'Set up Agent Office in this project. Work from the current project directory. Do not ask me to choose a file or folder at any step.',
  '',
  '0. PREREQUISITES AND COMPANION',
  '   - Check that `node` and `opencode` (OpenCode 2) are on PATH. If either is missing, state that prerequisite and stop before any write.',
  '   - Find the installed companion yourself: resolve `command -v agent-office`, or check `~/.config/openchamber/extensions/agent-office` and `~/.local/share/agent-office/checkout` for `companion/setup.mjs`. Verify the package name and Git origin. Do not search unrelated project folders.',
  `   - If missing, stop at the GitHub install link: ${OFFICE_REPO_URL}. Do not clone or install on my behalf. If only the old companion without shared/family.mjs is present, stop: its inspect may create a chat.`,
  '',
  '1. DISCOVERY (read only)',
  '   - Run the companion CLI `inspect` from this directory. If OpenCode has not loaded the project, tell me how to retry without creating a disposable chat.',
  '   - Record the exact lead id and candidate ids with their mode and hidden flags, the exact model ids from the host catalog, and the current Office settings with their sources. Quote ids as reported; never rename or substitute one.',
  '   - Inspect existing project definitions and plugin paths and report what already exists, so nothing is duplicated or overwritten.',
  '   - If no lead is selected or its id is missing/hidden, list the observed candidates and ask me to pick one, or offer to preview a starter lead. Never silently substitute another agent.',
  '',
  '2. PREVIEW (no writes)',
  '   - Run the companion setup with `--templates --plugin` and without `--apply`. Show exact target paths, skipped existing definitions, the observed lead id, and the observed lower-cost specialist model ids from the catalog.',
  '   - Ask me to confirm the lead and specialist model, or to explicitly keep the host default. Stop here until I approve the complete set of changes. No file may be written before that approval.',
  '',
  '3. SETUP (only after complete approval, idempotent)',
  '   - Apply only the approved project settings and missing optional files. Include the optional templates and/or project-local plugin only if I approved those pieces.',
  '   - Use exclusive create: never overwrite an existing definition, never replace a host-provided agent, never change global defaults.',
  '   - Preview again and verify existing definitions are unchanged and no duplicates were added. Persist the lead id exactly as validated. Re-running must produce the same result.',
  '',
  '4. SMOKE (safe, no paid models)',
  '   - Dispatch one small agreed task only with model ids I have confirmed are free for this session. If no free model is confirmed, skip the smoke and say why; never run a model of unknown or paid cost.',
  '   - Have the lead verify the result with a local check (a new file or an assertion). Inspect the team under that root and report the actual parent/child relationship, the observed lead and models, and the verification result. Distinguish missing evidence from success.',
  '   - Report the files touched and the checks run. Do not commit unless explicitly asked.',
].join('\n');
