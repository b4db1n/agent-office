#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect, saveSettings } from '../shared/settings.mjs';
import { dispatch } from '../shared/dispatch.mjs';

const run = promisify(execFile);

function usage() {
  return [
    'Agent Office CLI',
    '',
    'Commands:',
    '  inspect [directory]                 Show agents, model ids, settings and sources.',
    '  team <rootId> [directory]           Show the scoped family, active work and waiting forms/permissions.',
    '  dispatch <prompt> [--directory DIR] Dispatch through the configured lead.',
    '  stop <sessionId> [--directory DIR]  Interrupt one scoped target session.',
    '  followup <parentId> <text> [--directory DIR]',
    '                                      Send a note to the parent; refuses when it is waiting.',
    '  configure [--lead ID] [--leadModel ID] [--specialistModel ID]',
    '            [--parallelism N] [--budget N] [--scope project|global] [--directory DIR]',
    '  instructions                        Show project-local /office setup.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value.startsWith('--')) {
      const key = value.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(value);
    }
  }
  return { positional, flags };
}

async function resolveDirectory(value) {
  const directory = value ? resolve(process.cwd(), value) : process.cwd();
  return realpath(directory);
}

async function api(args) {
  const { stdout } = await run('opencode', ['api', ...args]);
  return JSON.parse(stdout);
}

async function sessionInfo(id) {
  try {
    const response = await api(['GET', `/api/session/${encodeURIComponent(id)}`]);
    return response?.data ?? null;
  } catch {
    return null;
  }
}

function locationOf(info) {
  return info?.location?.directory ?? null;
}

async function cmdInspect(positional, flags) {
  const dir = await resolveDirectory(positional[0] || flags.directory);
  process.stdout.write(JSON.stringify(await inspect(dir), null, 2) + '\n');
}

async function cmdTeam(positional, flags) {
  const rootId = positional[0];
  if (!rootId) throw new Error('A root session id is required.');
  const dir = await resolveDirectory(positional[1] || flags.directory);
  const root = await sessionInfo(rootId);
  if (!root) throw new Error('Root session not found.');
  if (locationOf(root) !== dir) {
    throw new Error('That root belongs to a different project directory.');
  }

  const family = new Map([[rootId, root]]);
  const queue = [rootId];
  while (queue.length > 0 && family.size < 200) {
    const parent = queue.shift();
    const response = await api([
      'GET',
      '/api/session',
      '--param',
      `parentID=${parent}`,
      '--param',
      'limit=100',
    ]);
    const data = response?.data ?? response;
    const rows = Array.isArray(data) ? data : [];
    const children = rows.filter((row) => row?.parentID === parent || row?.parentId === parent);
    for (const child of children) {
      if (!child.id || family.has(child.id)) continue;
      family.set(child.id, child);
      queue.push(child.id);
    }
  }

  const activeResponse = await api(['GET', '/api/session/active']);
  const activeData = activeResponse?.data ?? {};
  const active = new Set(Object.keys(activeData));

  const sessions = [];
  for (const [id, session] of family) {
    const formsResponse = await api(['GET', `/api/session/${encodeURIComponent(id)}/form`]).catch(() => ({ data: [] }));
    const permissionResponse = await api(['GET', `/api/session/${encodeURIComponent(id)}/permission`]).catch(() => ({ data: [] }));
    const forms = Array.isArray(formsResponse?.data) ? formsResponse.data : [];
    const permissions = Array.isArray(permissionResponse?.data) ? permissionResponse.data : [];
    sessions.push({
      id,
      title: session.title ?? '',
      parentId: session.parentID ?? session.parentId ?? null,
      agent: session.agent ?? null,
      model: session.model ?? null,
      outcome: session.outcome ?? null,
      active: active.has(id),
      waiting: {
        forms: forms.map((form) => ({ id: form.id, title: form.title })),
        permissions: permissions.map((permission) => ({ id: permission.id, action: permission.action })),
      },
    });
  }

  process.stdout.write(JSON.stringify({ rootId, directory: dir, sessions }, null, 2) + '\n');
}

async function cmdDispatch(positional, flags) {
  const prompt = positional.join(' ').trim();
  if (!prompt) throw new Error('Choose a message of 1-32,000 characters.');
  const dir = await resolveDirectory(flags.directory);
  process.stdout.write(JSON.stringify(await dispatch(dir, prompt), null, 2) + '\n');
}

async function cmdStop(positional, flags) {
  const id = positional[0];
  if (!id) throw new Error('A session id is required.');
  const dir = await resolveDirectory(flags.directory);
  const info = await sessionInfo(id);
  if (!info) throw new Error('Session not found.');
  if (locationOf(info) !== dir) throw new Error('That session belongs to a different project directory.');
  const response = await api(['POST', `/api/session/${encodeURIComponent(id)}/interrupt`]);
  process.stdout.write(JSON.stringify(response, null, 2) + '\n');
}

async function cmdFollowup(positional, flags) {
  const parentId = positional[0];
  const text = positional.slice(1).join(' ').trim();
  if (!parentId) throw new Error('A parent session id is required.');
  if (!text) throw new Error('Write a note first.');
  const dir = await resolveDirectory(flags.directory);
  const info = await sessionInfo(parentId);
  if (!info) throw new Error('Parent session not found.');
  if (locationOf(info) !== dir) throw new Error('That parent belongs to a different project directory.');
  const formsResponse = await api(['GET', `/api/session/${encodeURIComponent(parentId)}/form`]).catch(() => ({ data: [] }));
  const permissionResponse = await api(['GET', `/api/session/${encodeURIComponent(parentId)}/permission`]).catch(() => ({ data: [] }));
  const forms = Array.isArray(formsResponse?.data) ? formsResponse.data : [];
  const permissions = Array.isArray(permissionResponse?.data) ? permissionResponse.data : [];
  if (forms.length > 0 || permissions.length > 0) {
    throw new Error('Unsupported: that session is waiting on a form or permission; answer it in OpenCode.');
  }
  const response = await api([
    'POST',
    `/api/session/${encodeURIComponent(parentId)}/prompt`,
    '--data',
    JSON.stringify({ text }),
  ]);
  process.stdout.write(JSON.stringify(response, null, 2) + '\n');
}

async function cmdConfigure(positional, flags) {
  const dir = await resolveDirectory(flags.directory);
  const scope = flags.scope === 'global' ? 'global' : 'project';
  const values = {};
  if (flags.lead) values.lead = flags.lead;
  if (flags.leadModel) values.leadModel = flags.leadModel;
  if (flags.specialistModel) values.specialistModel = flags.specialistModel;
  if (flags.parallelism) values.parallelism = Number(flags.parallelism);
  if (flags.budget) values.budget = Number(flags.budget);
  await saveSettings(dir, scope, values);
  process.stdout.write(JSON.stringify(await inspect(dir), null, 2) + '\n');
}

function cmdInstructions() {
  process.stdout.write([
    'Project-local /office command',
    '',
    '1. Run "bun run build" in the Agent Office checkout to create plugin/index.js.',
    '2. Copy that one file into the target project at .opencode/plugins/agent-office/index.js.',
    '3. Reload OpenCode in the target project. No global configuration is needed.',
    '4. In an OpenCode chat in that project, type /office followed by a task.',
    '',
    'The command is an explicit gesture in OpenCode; it does not run from this CLI.',
  ].join('\n') + '\n');
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  const rest = positional.slice(1);
  try {
    switch (command) {
      case 'inspect':
        await cmdInspect(rest, flags);
        break;
      case 'team':
        await cmdTeam(rest, flags);
        break;
      case 'dispatch':
        await cmdDispatch(rest, flags);
        break;
      case 'stop':
        await cmdStop(rest, flags);
        break;
      case 'followup':
        await cmdFollowup(rest, flags);
        break;
      case 'configure':
        await cmdConfigure(rest, flags);
        break;
      case 'instructions':
        cmdInstructions();
        break;
      case undefined:
      case 'help':
        process.stdout.write(usage() + '\n');
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
