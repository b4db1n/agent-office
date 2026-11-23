/**
 * Agent Office — shared settings helpers.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

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
  for (const file of [stateFile(), ...STATE_CANDIDATES]) {
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (!parsed.global || typeof parsed.global !== 'object' || Array.isArray(parsed.global)) parsed.global = {};
        if (!parsed.projects || typeof parsed.projects !== 'object' || Array.isArray(parsed.projects)) parsed.projects = {};
        return parsed;
      }
    } catch {
      // Try next candidate.
    }
  }
  return emptyState();
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
        if (typeof value !== 'string') throw new Error(`${key} must be a string or null.`);
        out[key] = value;
        break;
      case 'agentModels':
        if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${key} must be an object or null.`);
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
  return result;
}

function sourcesFor(project, global) {
  const result = {};
  for (const key of SETTINGS_KEYS) {
    const value = Object.prototype.hasOwnProperty.call(project, key) ? project[key] : global[key];
    if (value === null || value === undefined) {
      result[key] = 'host';
    } else if (Object.prototype.hasOwnProperty.call(project, key)) {
      result[key] = 'project';
    } else if (Object.prototype.hasOwnProperty.call(global, key)) {
      result[key] = 'global';
    } else {
      result[key] = 'host';
    }
  }
  return result;
}

function sameDirectory(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return left === right;
  }
}

function addLocation(endpoint, directory) {
  return `${endpoint}?location%5Bdirectory%5D=${encodeURIComponent(directory)}`;
}

function apiCall(method, endpoint, body) {
  const args = ['api', method.toUpperCase(), endpoint];
  if (body !== undefined) args.push('--data', JSON.stringify(body));
  const stdout = execFileSync('opencode', args, {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
}

async function warmLocation(directory) {
  let sessionId = null;
  try {
    const created = apiCall('POST', '/api/session', {
      location: { directory },
      title: 'Agent Office discovery',
    });
    sessionId = created?.data?.id ?? null;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const agents = await apiGet('/api/agent', directory);
      if (Array.isArray(agents?.data) && agents.data.length > 0) return agents;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (sessionId) {
      try { apiCall('DELETE', `/api/session/${encodeURIComponent(sessionId)}`); } catch {}
    }
  }
}

async function apiGet(endpoint, directory) {
  const url = addLocation(endpoint, directory);
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const stdout = execFileSync('opencode', ['api', 'get', url], {
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const parsed = JSON.parse(stdout);
      if (!parsed || typeof parsed !== 'object' || !parsed.location || !sameDirectory(parsed.location.directory, directory)) {
        return null;
      }
      return parsed;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return null;
}

function sanitizeAgent(agent) {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return agent;
  const copy = { ...agent };
  for (const key of Object.keys(copy)) {
    if (key.toLowerCase().includes('prompt')) delete copy[key];
  }
  return copy;
}

export async function settingsView(directory) {
  const state = await readState();
  const global = normalizeScopeSettings(state.global);
  const project = normalizeScopeSettings(state.projects && state.projects[directory]);
  return {
    settings: effectiveSettings(project, global),
    sources: sourcesFor(project, global),
    project,
    global,
  };
}

export async function inspect(directory) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new Error('A project directory is required.');
  }

  let agentResponse = await apiGet('/api/agent', directory);
  if (!Array.isArray(agentResponse?.data) || agentResponse.data.length === 0) {
    agentResponse = await warmLocation(directory);
  }
  const modelResponse = await apiGet('/api/model', directory);
  const pluginResponse = await apiGet('/api/plugin', directory);

  const agents = Array.isArray(agentResponse?.data)
    ? agentResponse.data.map(sanitizeAgent)
    : [];

  const models = Array.isArray(modelResponse?.data)
    ? modelResponse.data
        .filter((model) => model && model.enabled === true)
        .map((model) => `${model.providerID}/${model.id}`)
    : [];

  const seenModels = new Set();
  const uniqueModels = [];
  for (const model of models) {
    if (seenModels.has(model)) continue;
    seenModels.add(model);
    uniqueModels.push(model);
  }

  const view = await settingsView(directory);

  let plugin = null;
  if (pluginResponse && pluginResponse.location && pluginResponse.location.directory === directory) {
    const list = Array.isArray(pluginResponse.data) ? pluginResponse.data : [];
    plugin = list.some((item) => {
      if (!item || typeof item !== 'object') return false;
      if (item.id === 'agent-office') return true;
      const source = item.source;
      if (source && typeof source === 'object') {
        const text = JSON.stringify(source);
        if (text.includes('agent-office')) return true;
      }
      return false;
    });
  }

  return {
    agents,
    models: uniqueModels,
    ...view,
    plugin,
  };
}

export async function saveSettings(directory, scope, values) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new Error('A project directory is required.');
  }
  if (scope !== 'global' && scope !== 'project') {
    throw new Error('Settings scope must be "global" or "project".');
  }
  const validated = validateValues(values || {});

  const state = await readState();
  if (!state.global || typeof state.global !== 'object' || Array.isArray(state.global)) state.global = {};
  if (!state.projects || typeof state.projects !== 'object' || Array.isArray(state.projects)) state.projects = {};

  if (scope === 'global') {
    state.global = { ...state.global, ...validated };
  } else {
    const current = state.projects[directory];
    const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    state.projects[directory] = { ...base, ...validated };
  }

  const file = stateFile();
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const payload = JSON.stringify(state, null, 2) + '\n';
  await writeFile(temp, payload, 'utf8');
  await rename(temp, file);
  return true;
}

export default { inspect, saveSettings, settingsView, SETTINGS_KEYS };
