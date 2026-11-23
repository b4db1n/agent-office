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

/**
 * Prompt that drives an idempotent Agent Office setup: discovery, preview,
 * setup, smoke. Safe to paste into a fresh session that owns the project.
 */
export const SETUP_PROMPT = [
  'Set up Agent Office in this project. Use the installed Agent Office companion. If it is unavailable, explain how to install it before making changes.',
  '',
  '1. DISCOVERY (read only)',
  '   - Inspect the live OpenCode agent and model lists in this directory. Show the current Office settings and their sources.',
  '   - Identify a lead candidate (a visible, top-level-capable agent) plus optional implementer and reviewer agents.',
  '   - If no lead is selected or its ID is missing, offer an available primary agent or preview an optional starter lead. Do not silently substitute one.',
  '   - Record what already exists so you do not duplicate it.',
  '',
  '2. PREVIEW (no writes)',
  '   - Run the installer in preview mode. Show exact paths, skipped existing definitions, the proposed lead, and lower-cost specialist models from the host catalog.',
  '   - Ask the user to select the lead and specialist model, or explicitly keep the host default.',
  '   - Wait for confirmation before writing anything.',
  '',
  '3. SETUP (idempotent)',
  '   - Apply only the approved project settings and missing optional templates. Never overwrite an existing definition or change global defaults.',
  '   - Preview a second time and verify existing files are unchanged.',
  '   - Persist the lead id exactly as validated. Re-running must produce the same result with no duplicates.',
  '',
  '4. SMOKE (verify)',
  '   - Dispatch one small agreed task through Agent Office using the selected lead and a real specialist. Have the lead verify the resulting file or check.',
  '   - Inspect the team under that root. Report the actual parent/child relationship, observed models, and verification result; distinguish missing evidence from success.',
  '   - Report the files touched and the checks run. Do not commit unless explicitly asked.',
].join('\n');
