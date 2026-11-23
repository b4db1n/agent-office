import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, rm, open as openFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspect } from '../shared/settings.mjs';
import { selectLead } from '../shared/setup.mjs';

const run = promisify(execFile);
function defaultRun() { return run; }
const MAX_PROMPT = 32000;
const INPUT_TOKENS = 4000;
const OUTPUT_TOKENS = 4000;

function api(run, args) {
  return run('opencode', ['api', ...args]);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(path, value) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temp, path);
}

async function withLock(lockPath, fn) {
  const started = Date.now();
  while (true) {
    try {
      const handle = await openFile(lockPath, 'wx');
      await handle.close();
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - started > 10000) throw new Error('Could not acquire the dispatch lock.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

function stateDir() {
  const base = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(base, 'agent-office', 'ledgers');
}

function ledgerPaths(directory) {
  const key = createHash('sha256').update(directory).digest('hex').slice(0, 24);
  const path = join(stateDir(), `${key}.json`);
  return { path, lock: `${path}.lock` };
}

function parseModel(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const at = text.lastIndexOf('/');
  if (at <= 0 || at === text.length - 1) return null;
  const providerID = text.slice(0, at);
  const id = text.slice(at + 1);
  if (/\s/.test(providerID) || /\s/.test(id)) return null;
  return { id, providerID };
}

function agentModelRef(agent) {
  const value = agent?.model;
  if (!value || typeof value !== 'object') return null;
  return parseModel(`${value.providerID}/${value.id ?? value.modelID}`);
}

function findModel(catalog, ref) {
  if (!ref) return null;
  return catalog.find((model) =>
    (model.id === ref.id || model.modelID === ref.id) && model.providerID === ref.providerID) || null;
}

function modelCost(model) {
  const entry = Array.isArray(model?.cost) ? model.cost[0] : null;
  if (!entry || typeof entry !== 'object') return null;
  const input = Number(entry.input);
  const output = Number(entry.output);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { input, output };
}

async function catalogFor(run, directory) {
  const { stdout } = await api(run, [
    'GET',
    '/api/model',
    '--param',
    `location[directory]=${directory}`,
  ]);
  const parsed = JSON.parse(stdout);
  const data = parsed?.data ?? parsed;
  return Array.isArray(data) ? data : [];
}

async function hostDefault(run, directory) {
  try {
    const { stdout } = await api(run, [
      'GET',
      '/api/model/default',
      '--param',
      `location[directory]=${directory}`,
    ]);
    const ref = JSON.parse(stdout)?.data;
    return parseModel(`${ref?.providerID}/${ref?.id ?? ref?.modelID}`);
  } catch {
    return null;
  }
}

async function sessionInfo(run, id) {
  try {
    const { stdout } = await api(run, ['GET', `/api/session/${encodeURIComponent(id)}`]);
    return JSON.parse(stdout)?.data ?? null;
  } catch {
    return null;
  }
}

async function activeIds(run) {
  try {
    const { stdout } = await api(run, ['GET', '/api/session/active']);
    const data = JSON.parse(stdout)?.data ?? {};
    return new Set(Object.keys(data));
  } catch {
    return new Set();
  }
}

async function children(run, rootId) {
  try {
    const { stdout } = await api(run, [
      'GET',
      '/api/session',
      '--param',
      `parentID=${rootId}`,
      '--param',
      'limit=100',
    ]);
    const parsed = JSON.parse(stdout);
    const data = parsed?.data ?? parsed;
    const rows = Array.isArray(data) ? data : [];
    return rows.filter((row) => row?.parentID === rootId || row?.parentId === rootId);
  } catch {
    return [];
  }
}

function isFinished(info, active) {
  if (!info) return true;
  if (typeof info.time?.archived === 'number' && info.time.archived > 0) return true;
  if (typeof info.outcome === 'string' && info.outcome.length > 0 && !active.has(info.id)) return true;
  return false;
}

async function reconcile(run, ledger, directory) {
  const active = await activeIds(run);
  const roots = Array.isArray(ledger.roots) ? ledger.roots : [];
  const kept = [];
  for (const root of roots) {
    const info = root.sessionId ? await sessionInfo(run, root.sessionId) : null;
    const location = info?.location?.directory;
    if (location && location !== directory) continue;
    const kids = root.sessionId ? await children(run, root.sessionId) : [];
    const childActive = kids.some((child) => active.has(child.id));
    const finished = isFinished(info, active) && !childActive;
    const stale = !root.sessionId && Date.now() - (root.issuedAt || 0) > 60000;
    if (finished || stale) continue;
    kept.push(root);
  }
  ledger.roots = kept;
  return kept.length;
}

export async function dispatch(directory, prompt, options = {}) {
  const run = options.run ?? defaultRun();
  const inspectFn = options.inspectFn ?? inspect;
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new Error('Select a project directory.');
  }
  if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > MAX_PROMPT) {
    throw new Error(`Choose a message of 1-${MAX_PROMPT} characters.`);
  }

  const dir = await realpath(directory);
  const info = await inspectFn(dir);
  const selection = selectLead(info.agents || [], info.settings?.lead ?? null);
  if (selection.nextAction !== 'ready') {
    throw new Error('Select a lead agent before dispatching.');
  }
  const lead = (info.agents || []).find((agent) => (agent.id ?? agent.name) === selection.selected) || {};

  const catalog = await catalogFor(run, dir);
  const configured = parseModel(info.settings?.leadModel);
  const agentRef = agentModelRef(lead);
  const fallback = configured || agentRef || await hostDefault(run, dir);
  const leadRef = findModel(catalog, fallback);
  if (!leadRef) {
    throw new Error('Configure leadModel as provider/model or use an agent or host default.');
  }

  const cost = modelCost(leadRef);
  const budget = Number(info.settings?.budget);
  const finiteBudget = Number.isFinite(budget) && budget >= 0;
  if (!cost && finiteBudget) {
    throw new Error('Model cost is unknown with a finite budget; refusing to dispatch.');
  }

  const parallelism = Number(info.settings?.parallelism ?? 1);
  if (!Number.isFinite(parallelism) || parallelism < 1) {
    throw new Error('Parallelism is not configured.');
  }
  const estimatedCost = cost ? (cost.input * INPUT_TOKENS + cost.output * OUTPUT_TOKENS) / 1_000_000 : 0;

  const specialistRef = parseModel(info.settings?.specialistModel);
  if (specialistRef && !findModel(catalog, specialistRef)) {
    throw new Error('specialistModel is not in the model catalog.');
  }

  const { path: ledgerPath, lock: lockPath } = ledgerPaths(dir);
  await mkdir(join(ledgerPath, '..'), { recursive: true });

  const reservationId = randomUUID();
  await withLock(lockPath, async () => {
    const ledger = (await readJson(ledgerPath)) || { roots: [], spent: 0 };
    const count = await reconcile(run, ledger, dir);
    if (count >= parallelism) throw new Error('Parallelism limit reached.');
    if (finiteBudget && Number(ledger.spent || 0) + estimatedCost > budget) {
      throw new Error('Budget exceeded.');
    }
    ledger.roots = ledger.roots || [];
    ledger.roots.push({
      id: reservationId,
      sessionId: null,
      issuedAt: Date.now(),
      lead: selection.selected,
      model: `${leadRef.providerID}/${leadRef.id}`,
    });
    ledger.spent = Number(ledger.spent || 0) + estimatedCost;
    await writeJsonAtomic(ledgerPath, ledger);
  });

  let sessionId;
  try {
    const { stdout } = await api(run, [
      'POST',
      '/api/session',
      '--data',
      JSON.stringify({
        agent: selection.selected,
        model: { id: leadRef.id, providerID: leadRef.providerID },
        location: { directory: dir },
        title: `Office: ${prompt.trim().slice(0, 60)}`,
      }),
    ]);
    const created = JSON.parse(stdout)?.data;
    sessionId = created?.id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('Session creation failed.');
  } catch (error) {
    await withLock(lockPath, async () => {
      const ledger = (await readJson(ledgerPath)) || { roots: [], spent: 0 };
      ledger.roots = (ledger.roots || []).filter((root) => root.id !== reservationId);
      await writeJsonAtomic(ledgerPath, ledger);
    }).catch(() => undefined);
    throw error;
  }

  await withLock(lockPath, async () => {
    const ledger = (await readJson(ledgerPath)) || { roots: [], spent: 0 };
    const root = (ledger.roots || []).find((item) => item.id === reservationId);
    if (root) root.sessionId = sessionId;
    await writeJsonAtomic(ledgerPath, ledger);
  }).catch(() => undefined);

  let text = prompt.trim();
  if (specialistRef) {
    text += `\n\nWhen delegating to child agents or specialists, use model ${specialistRef.providerID}/${specialistRef.id} unless the task requires otherwise.`;
  }
  await api(run, [
    'POST',
    `/api/session/${encodeURIComponent(sessionId)}/prompt`,
    '--data',
    JSON.stringify({ text }),
  ]);

  return {
    sessionId,
    rootId: sessionId,
    lead: selection.selected,
    leadModel: `${leadRef.providerID}/${leadRef.id}`,
    specialistModel: info.settings?.specialistModel ?? null,
    directory: dir,
  };
}
