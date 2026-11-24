#!/usr/bin/env node
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { inspect, saveSettings } from '../shared/settings.mjs';
import { dispatch, admissionView } from '../shared/dispatch.mjs';
import { family, hostApi } from '../shared/family.mjs';
import { officeError } from '../shared/host.mjs';
import { usage } from '../shared/usage.mjs';

const help = `Office Steward CLI (current project by default)
  inspect [directory]
  team <rootId> [directory]
  cost <rootId> [directory]
  dispatch "task" [--directory DIR]
  stop <sessionId> --root ROOT [--directory DIR]
  configure [--lead ID] [--leadModel MODEL] [--specialistModel MODEL]
            [--parallelism N] [--budget N|null] [--scope project|global]
Use Ask Office lead on your own message. Talk opens an existing chat.
Read-only operations require an already-running OpenCode 2 host.`;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// V2 /api/session/active is a plain map of session id -> {type:'running'}.
// Arrays, primitives and malformed entries are not a usable observation.
function readActive(value) {
  if (!isRecord(value)) return {map:null,ok:false};
  for (const entry of Object.values(value)) {
    if (!isRecord(entry) || entry.type !== 'running') return {map:null,ok:false};
  }
  return {map:value,ok:true};
}

// Form/permission rows are records with their owning session id. Keep only
// minimal display fields; foreign or malformed rows make the read unknown.
function readWaiting(rows, sessionId, kind) {
  if (!Array.isArray(rows)) return {rows:null,ok:false};
  const kept = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== 'string' || row.id === '' || row.sessionID !== sessionId) {
      return {rows:null,ok:false};
    }
    kept.push(kind === 'form' ? {id:row.id,title:row.title} : {id:row.id,action:row.action});
  }
  return {rows:kept,ok:true};
}

export async function command(argv, api = hostApi()) {
  const [cmd,...args] = argv;
  const flags = Object.create(null), pos = [];
  for (let i=0;i<args.length;i++) {
    if (!args[i].startsWith('--')) { pos.push(args[i]); continue; }
    const key = args[i].slice(2);
    if (!['directory','root','lead','leadModel','specialistModel','parallelism','budget','scope'].includes(key) ||
        !args[i+1] || args[i+1].startsWith('--')) throw new Error('Invalid option or missing value.');
    flags[key] = args[++i];
  }
  if (!cmd || ['help','--help','instructions'].includes(cmd)) return help;
  const dir = await realpath(flags.directory ?? (cmd === 'inspect' ? pos[0] : ['team','cost'].includes(cmd) ? pos[1] : undefined) ?? '.');
  if (cmd === 'inspect') return {...await inspect(dir),reservations:await admissionView(dir)};
  if (cmd === 'dispatch') return dispatch(dir,pos.join(' '));
  if (cmd === 'followup') throw new Error('Open the existing chat to send a follow-up or answer a waiting request.');
  if (cmd === 'configure') {
    const {scope='project',directory,...values} = flags;
    const info = await inspect(dir);
    if (values.lead && !info.agents.some(a => a.id===values.lead && !a.hidden && !a.subagentOnly && a.mode!=='subagent')) throw new Error('Lead unavailable.');
    for (const k of ['leadModel','specialistModel']) {
      if (values[k] && !info.models.includes(values[k].split('#')[0])) throw new Error('Model unavailable.');
    }
    if (values.budget !== undefined) values.budget = values.budget === 'null' ? null : Number(values.budget);
    if (values.parallelism !== undefined) values.parallelism = Number(values.parallelism);
    await saveSettings(dir,scope,values);
    return inspect(dir);
  }
  const rootId = cmd === 'stop' ? flags.root : pos[0];
  if (!rootId) throw new Error('Select an Office root; stop requires --root ROOT.');
  if (cmd === 'cost') return usage(dir,rootId,{api});
  if (!['team','stop'].includes(cmd)) throw new Error('Unknown command.');
  const tree = await family(api,dir,rootId);
  if (cmd === 'stop') {
    if (!tree.sessions.some(s => s.id === pos[0])) throw new Error('Target is outside the selected Office team.');
    return api('POST',`/api/session/${encodeURIComponent(pos[0])}/interrupt`);
  }
  const active = readActive(await api('GET','/api/session/active').catch(() => null));
  const sessions = [];
  let observationPartial = !active.ok;
  for (const session of tree.sessions) {
    const path = `/api/session/${encodeURIComponent(session.id)}`;
    const [forms,permissions] = await Promise.all(['form','permission'].map(async kind => {
      try { return readWaiting(await api('GET',`${path}/${kind}`),session.id,kind); }
      catch { return {rows:null,ok:false}; }
    }));
    observationPartial ||= !forms.ok || !permissions.ok;
    sessions.push({id:session.id,parentId:session.parentID ?? null,title:session.title,
      selectedAgent:session.agent,selectedModel:session.model,origin:session.metadata?.agentOfficeOrigin,
      outcome:session.outcome ?? null,
      active:active.ok ? (active.map[session.id]?.type === 'running') : null,
      waiting:{forms:forms.rows,permissions:permissions.rows}});
  }
  return {directory:dir,rootId,partial:tree.partial || observationPartial,sessions};
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  command(process.argv.slice(2)).then(result => console.log(typeof result==='string' ? result : JSON.stringify(result,null,2)))
    .catch(error => { console.error(officeError(error)); process.exitCode=1; });
}
