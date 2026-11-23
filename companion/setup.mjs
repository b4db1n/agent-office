#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectLead } from '../shared/setup.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function agentIds(agents) {
  if (Array.isArray(agents)) return agents.map((a) => (typeof a === 'string' ? a : a && a.id)).filter(Boolean);
  if (agents && typeof agents === 'object') return Object.keys(agents).filter(Boolean);
  return [];
}

function visiblePrimaryAgents(agents) {
  const list = Array.isArray(agents) ? agents : (agents && typeof agents === 'object' ? Object.values(agents) : []);
  return list.filter((agent) => {
    if (!agent || typeof agent !== 'object') return false;
    if (agent.hidden === true) return false;
    if (agent.subagent === true || agent.subagentOnly === true) return false;
    const mode = agent.mode;
    return mode === 'primary' || mode === 'all' || mode === undefined || mode === null || mode === '';
  });
}

async function statPath(p) {
  try { return await lstat(p); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function assertNoSymlinkEscape(cwd, targetPath) {
  const rel = relative(cwd, targetPath);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Refusing path outside project.');
  let current = cwd;
  for (const part of rel.split('/').filter(Boolean)) {
    current = join(current, part);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new Error('Refusing symbolic link in setup path.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

const SMOKE_GUIDANCE = [
  'Preview: node companion/setup.mjs',
  'Apply templates: node companion/setup.mjs --apply --templates',
  'Apply plugin: node companion/setup.mjs --apply --plugin',
  'Re-run either command to confirm no overwrites and no duplicates.',
];

export async function install(directory, args = [], agents = [], selectedLead = null, options = {}) {
  const argList = Array.isArray(args) ? args : [String(args)];
  const flags = [];
  let leadId = selectedLead;
  let opts = options || {};
  if (leadId && typeof leadId === 'object') {
    opts = { ...opts, ...leadId };
    leadId = leadId.selectedLead ?? leadId.lead ?? leadId.selected ?? null;
  }
  for (let i = 0; i < argList.length; i++) {
    const a = argList[i];
    if (a === '--apply' || a === '--templates' || a === '--plugin') flags.push(a);
    else if (a === '--lead') leadId = argList[++i] ?? null;
    else if (a.startsWith('--lead=')) leadId = a.slice('--lead='.length);
    else throw new Error('Unknown setup option.');
  }
  const apply = flags.includes('--apply');
  const doTemplates = flags.includes('--templates');
  const doPlugin = flags.includes('--plugin');

  const cwd = await realpath(directory);
  const ids = agentIds(agents);
  const rows = [];

  async function plan(source, components, name, shadowed) {
    let dir = cwd;
    for (const component of components) {
      dir = join(dir, component);
      const entry = await statPath(dir);
      if (!entry) continue;
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('Refusing non-directory or symbolic link in setup path.');
    }
    const target = join(dir, name);
    const entry = await statPath(target);
    if (entry && entry.isSymbolicLink()) throw new Error('Refusing symbolic link target.');
    let status;
    if (entry) status = 'existing file';
    else if (shadowed) status = 'already available from host';
    else status = 'create';
    if (status === 'create') await access(join(root, source), constants.R_OK);
    rows.push({ path: [...components, name].join('/'), status, source });
  }

  if (doTemplates) {
    for (const id of ['lead', 'implementer', 'reviewer']) {
      await plan(`templates/${id}.md`, ['.opencode', 'agents'], `${id}.md`, ids.includes(id));
    }
  }
  if (doPlugin) {
    await plan('plugin/index.js', ['.opencode', 'plugins', 'agent-office'], 'index.js', false);
  }

  if (apply) {
    for (const row of rows.filter((row) => row.status === 'create')) {
      const dest = join(cwd, row.path);
      await assertNoSymlinkEscape(cwd, dest);
      const parent = resolve(dest, '..');
      await mkdir(parent, { recursive: true });
      await assertNoSymlinkEscape(cwd, parent);
      try {
        await copyFile(join(root, row.source), dest, constants.COPYFILE_EXCL);
        row.status = 'created';
      } catch (error) {
        if (error.code === 'EEXIST') row.status = 'existing file';
        else throw error;
      }
    }
  }

  const lead = selectLead(agents, leadId);
  const selectable = visiblePrimaryAgents(agents).map((a) => a.id);
  const models = Array.isArray(opts.models) ? opts.models : [];
  const result = {
    mode: apply ? 'apply' : 'preview',
    lead,
    selectableAgents: selectable,
    models: models.map((m) => (m && typeof m === 'object' ? (m.providerID ? `${m.providerID}/${m.id}` : m.id) : String(m))),
    files: rows.map(({ source, ...row }) => row),
    smoke: SMOKE_GUIDANCE,
  };
  if (leadId && lead.selected === null && lead.available.length > 0) {
    result.missing = leadId;
  }
  return result;
}

function discoverViaCli(cwd, endpoint) {
  const query = new URLSearchParams({ 'location[directory]': cwd });
  const out = execFileSync('opencode', ['api', 'get', `${endpoint}?${query}`], { encoding: 'utf8', cwd, maxBuffer: 16 << 20 });
  const catalog = JSON.parse(out);
  if (catalog.location?.directory !== cwd || !catalog.data?.length) throw Error('Project catalog is not ready; no files changed.');
  return catalog.data;
}

async function main() {
  const cwd = await realpath(process.cwd());
  let agents = [];
  let models = [];
  try {
    agents = discoverViaCli(cwd, '/api/agent');
    models = discoverViaCli(cwd, '/api/model');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const result = await install(cwd, process.argv.slice(2), agents, null, { models });
  console.log(JSON.stringify(result, null, 2));
  if (result.missing) {
    console.error(`Lead ${result.missing}: missing (no automatic substitution)`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

export default install;
