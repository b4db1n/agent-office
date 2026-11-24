/**
 * Agent Office — shared settings helpers.
 */

import { mkdir, open, readFile, rename, realpath, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { runOpenCode } from './host.mjs';
import { normalizeDepartments } from './departments.mjs';

export const SETTINGS_KEYS = Object.freeze([
  'lead',
  'leadModel',
  'specialistModel',
  'agentModels',
  'language',
  'appearance',
  'notifications',
  'visibleControls',
  'parallelism',
  'budget',
  'advisor',
  'departments',
]);

const DEFAULT_SETTINGS = Object.freeze(
  Object.fromEntries(SETTINGS_KEYS.map((key) => [key, null])),
);

const STATE_CANDIDATES = [
  path.join(homedir(), '.config', 'agent-office', 'settings.json'),
  path.join(homedir(), '.config', 'openchamber', 'agent-office.json'),
  path.join(homedir(), '.agent-office', 'settings.json'),
];

function stateFile() {
  if (process.env.AGENT_OFFICE_SETTINGS_FILE) return process.env.AGENT_OFFICE_SETTINGS_FILE;
  return STATE_CANDIDATES[0];
}

function emptyState() {
  return { version: 1, global: { ...DEFAULT_SETTINGS }, projects: {} };
}

async function readState() {
  const files = process.env.AGENT_OFFICE_SETTINGS_FILE ? [stateFile()] : STATE_CANDIDATES;
  for (const file of files) {
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error('Invalid Office settings.');
      for (const key of ['global', 'projects']) {
        if (own(parsed, key) && !isRecord(parsed[key])) throw new Error('Invalid settings layer.');
      }
      return { ...parsed, global: parsed.global ?? {}, projects: parsed.projects ?? {} };
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Agent Office could not read its saved settings. No changes were made.');
    }
  }
  return emptyState();
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

// A scope holds only what it sets. Filling absent keys with null would make an
// empty project layer override every global value.
function normalizeScopeSettings(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      result[key] = value[key];
    }
  }
  return result;
}

function validateValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Settings values must be an object.');
  }
  const unknown = Object.keys(values).filter((key) => !SETTINGS_KEYS.includes(key));
  if (unknown.length) throw new Error(`Unknown settings key: ${unknown.join(', ')}.`);

  const out = {};
  for (const key of Object.keys(values)) {
    const value = values[key];
    if (value === null) {
      out[key] = null;
      continue;
    }
    switch (key) {
      case 'lead':
      case 'leadModel':
      case 'specialistModel':
      case 'language':
      case 'appearance':
      case 'advisor':
        if (typeof value !== 'string') throw new Error(`${key} must be a string or null.`);
        out[key] = value;
        break;
      case 'departments':
        out[key] = normalizeDepartments(value);
        break;
      case 'agentModels':
        if (!isRecord(value) || Object.values(value).some((entry) => entry !== null && (typeof entry !== 'string' || !entry.trim()))) {
          throw new Error('Agent model overrides must map agent IDs to provider/model values or null.');
        }
        out[key] = value;
        break;
      case 'notifications':
        if (typeof value !== 'boolean' && !(typeof value === 'object' && !Array.isArray(value))) {
          throw new Error(`${key} must be a boolean, object, or null.`);
        }
        out[key] = value;
        break;
      case 'visibleControls':
        if (!Array.isArray(value) && !(typeof value === 'object' && value !== null)) {
          throw new Error(`${key} must be an array, object, or null.`);
        }
        out[key] = value;
        break;
      case 'parallelism':
      case 'budget':
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a number or null.`);
        if (key === 'parallelism' && (!Number.isInteger(value) || value < 0)) throw new Error('Parallelism must be a non-negative whole number.');
        if (key === 'budget' && value < 0) throw new Error('Budget cannot be negative.');
        out[key] = value;
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

function effectiveSettings(project, global) {
  const result = { ...DEFAULT_SETTINGS };
  for (const key of SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(global, key) && global[key] !== undefined) {
      result[key] = global[key];
    }
    if (Object.prototype.hasOwnProperty.call(project, key) && project[key] !== undefined) {
      result[key] = project[key];
    }
  }
  if (isRecord(project.agentModels)) {
    result.agentModels = { ...(isRecord(global.agentModels) ? global.agentModels : {}), ...project.agentModels };
  }
  return result;
}

function sourcesFor(project, global) {
  const result = {};
  for (const key of SETTINGS_KEYS) {
    if (own(project, key)) result[key] = project[key] === null ? 'project (explicit default)' : 'project';
    else if (global[key] != null) result[key] = 'global';
    else result[key] = 'host';
  }
  return result;
}

function addLocation(endpoint, directory) {
  return `${endpoint}?location%5Bdirectory%5D=${encodeURIComponent(directory)}`;
}

async function apiGet(run, endpoint, directory) {
  try {
    const { stdout } = await run('opencode', ['api', 'get', addLocation(endpoint, directory)], {
      encoding: 'utf8',
      timeout: 4500,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    const reported = parsed?.location?.directory;
    if (typeof reported !== 'string' || await realpath(reported) !== directory) return null;
    return parsed;
  } catch {
    return null;
  }
}

function modelRef(value) {
  const id = value?.id ?? value?.modelID;
  if (typeof id !== 'string' || typeof value?.providerID !== 'string') return null;
  const variant = typeof value.variant === 'string' ? value.variant : null;
  return { id, providerID: value.providerID, ...(variant ? { variant } : {}) };
}

function sanitizeAgent(agent) {
  if (!isRecord(agent) || typeof (agent.id ?? agent.name) !== 'string') return null;
  return {
    id: agent.id ?? agent.name,
    ...(typeof agent.mode === 'string' ? { mode: agent.mode } : {}),
    hidden: agent.hidden === true,
    subagentOnly: agent.subagentOnly === true || agent.subagent === true,
    model: modelRef(agent.model),
  };
}

export async function settingsView(directory) {
  const canonical = await realpath(directory);
  const state = await readState();
  const global = normalizeScopeSettings(state.global);
  const project = normalizeScopeSettings(state.projects[canonical] ?? state.projects[directory]);
  return {
    settings: effectiveSettings(project, global),
    sources: sourcesFor(project, global),
    project,
    global,
  };
}

export async function inspect(directory, options = {}) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new Error('A project directory is required.');
  }
  const canonical = await realpath(directory);
  const run = options.run ?? runOpenCode;
  const [agentResponse, modelResponse, pluginResponse, defaultResponse, view] = await Promise.all([
    apiGet(run, '/api/agent', canonical),
    apiGet(run, '/api/model', canonical),
    apiGet(run, '/api/plugin', canonical),
    apiGet(run, '/api/model/default', canonical),
    settingsView(directory),
  ]);

  const agents = Array.isArray(agentResponse?.data)
    ? agentResponse.data.map(sanitizeAgent).filter(Boolean)
    : [];

  const models = Array.isArray(modelResponse?.data)
    ? modelResponse.data
        .filter((model) => model?.enabled === true)
        .map(modelRef).filter(Boolean).map(({ providerID, id }) => `${providerID}/${id}`)
    : [];

  const plugin = Array.isArray(pluginResponse?.data)
    ? pluginResponse.data.some((item) => item?.id === 'agent-office' && item.state?.status === 'active')
    : null;
  return {
    agents,
    models: [...new Set(models)],
    variants: Object.fromEntries((Array.isArray(modelResponse?.data) ? modelResponse.data : [])
      .filter(m => m?.enabled === true).map(m => [`${m.providerID}/${m.id}`, (m.variants ?? []).map(v => v.id)])),
    ...view,
    plugin,
    agentDiscovery: !Array.isArray(agentResponse?.data) ? 'unavailable' : agents.length ? 'ready' : 'empty',
    modelDiscovery: !Array.isArray(modelResponse?.data) ? 'unavailable' : models.length ? 'ready' : 'empty',
    hostModel: modelRef(defaultResponse?.data),
    rates: Object.fromEntries((Array.isArray(modelResponse?.data) ? modelResponse.data : []).filter(m => m?.enabled === true).map(m =>
      [`${m.providerID}/${m.id}`, Array.isArray(m.cost) ? m.cost.map(({input, output, cache, tier}) => ({input, output, cache, tier})) : null])),
  };
}

async function withSettingsLock(file, fn) {
  const lock = `${file}.lock`;
  let handle;
  for (let attempt = 0; !handle; attempt++) {
    try {
      handle = await open(lock, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt >= 60) throw new Error('Agent Office settings are busy. Try again.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(lock);
  }
}

export async function saveSettings(directory, scope, values, unset = []) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new Error('A project directory is required.');
  }
  if (scope !== 'global' && scope !== 'project') {
    throw new Error('Settings scope must be "global" or "project".');
  }
  const validated = validateValues(values || {});
  if (!Array.isArray(unset) || unset.some((key) => !SETTINGS_KEYS.includes(key) || own(validated, key))) {
    throw new Error('Invalid inherited settings selection.');
  }
  const canonical = await realpath(directory);

  const file = stateFile();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  return withSettingsLock(file, async () => {
    const state = await readState();
    const current = scope === 'global' ? state.global : state.projects[canonical] ?? state.projects[directory];
    const layer = { ...(isRecord(current) ? current : {}), ...validated };
    for (const key of unset) delete layer[key];
    if (scope === 'global') state.global = layer;
    else state.projects[canonical] = layer;
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const payload = JSON.stringify(state, null, 2) + '\n';
    try {
      await writeFile(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temp, file);
    } finally {
      await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
    return true;
  });
}

export default { inspect, saveSettings, settingsView, SETTINGS_KEYS };
