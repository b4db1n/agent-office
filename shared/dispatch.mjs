import { runOpenCode } from './host.mjs';
import { hostApi, family } from './family.mjs';
import { mkdir, readFile, writeFile, rename, rm, open as openFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspect } from '../shared/settings.mjs';
import { selectLead } from '../shared/setup.mjs';
import { departmentsFor, withDepartmentContext } from '../shared/departments.mjs';
import { readDepartmentJournal } from '../shared/lessons.mjs';

const MAX_PROMPT = 32000;
const INPUT_TOKENS = 4000;
const OUTPUT_TOKENS = 4000;

function api(run, args) {
  return run('opencode', ['api', ...args]);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Office admission ledger is unreadable; no task sent.');
  }
}

async function writeJsonAtomic(path, value) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', {mode:0o600, flag:'wx'});
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

export async function admissionView(directory) {
  const ledger = await readJson(ledgerPaths(await realpath(directory)).path);
  if (ledger && !Array.isArray(ledger.roots)) throw new Error('Invalid Office ledger.');
  return [...(ledger?.recent ?? []), ...(ledger?.roots ?? [])].map(r => ({rootId:r.sessionId ?? r.requestId ?? null,
    phase:r.phase ?? 'legacy', estimatedLeadCost:r.estimate ?? null}));
}

function parseModel(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const at = text.lastIndexOf('/');
  if (at <= 0 || at === text.length - 1) return null;
  const providerID = text.slice(0, at);
  const [id, variant, extra] = text.slice(at + 1).split('#');
  if (!id || extra !== undefined || variant === '' || /[\s#]/.test(providerID) || /\s/.test(text)) return null;
  return { id, providerID, ...(variant ? {variant} : {}) };
}

function agentModelRef(agent) {
  const value = agent?.model;
  if (!value || typeof value !== 'object') return null;
  return parseModel(`${value.providerID}/${value.id ?? value.modelID}${value.variant ? `#${value.variant}` : ''}`);
}

function findModel(catalog, ref) {
  if (!ref) return null;
  return catalog.find((model) =>
    model.id === ref.id && model.providerID === ref.providerID && model.enabled === true &&
    (!ref.variant || model.variants?.some(v => v.id === ref.variant))) || null;
}

function modelCost(model) {
  const entry = Array.isArray(model?.cost) ? model.cost[0] : null;
  if (!entry || typeof entry !== 'object') return null;
  if (model.cost.length !== 1 || entry.tier !== undefined) return null;
  const {input,output} = entry;
  if (![input,output].every(n => Number.isFinite(n) && n >= 0)) return null;
  return { input, output };
}

async function catalogFor(run, directory) {
  const { stdout } = await api(run, [
    'GET',
    `/api/model?${new URLSearchParams({'location[directory]':directory})}`,
  ]);
  const parsed = JSON.parse(stdout);
  if (parsed?.location?.directory !== directory) throw new Error('Model catalog did not confirm the project.');
  const data = parsed?.data;
  return Array.isArray(data) ? data : [];
}

async function hostDefault(run, directory) {
  try {
    const { stdout } = await api(run, [
      'GET',
      `/api/model/default?${new URLSearchParams({'location[directory]':directory})}`,
    ]);
    const response = JSON.parse(stdout);
    if (response?.location?.directory !== directory) return null;
    const ref = response.data;
    return ref ? agentModelRef({model:ref}) : null;
  } catch {
    return null;
  }
}

async function reconcile(run, ledger, directory) {
  if (!Array.isArray(ledger.roots)) throw new Error('Invalid Office ledger.');
  if (!ledger.roots.length) return 0;
  const read = hostApi(run);
  const active = await read('GET', '/api/session/active');
  if (!active || typeof active !== 'object' || Array.isArray(active)) throw new Error('Cannot verify active work.');
  const kept = [];
  for (const root of ledger.roots) {
    if ((root.sessionId || root.requestId) && root.phase !== 'sending') {
      try {
        const tree = await family(read,directory,root.sessionId ?? root.requestId);
        if (!tree.partial && tree.sessions.every(s => !Object.hasOwn(active,s.id) &&
          ['succeeded','failed','interrupted'].includes(s.outcome))) {
          // Retain bounded, non-content receipts for the Steward. A terminal
          // host outcome is not acceptance evidence.
          (ledger.recent ??= []).push({sessionId:tree.sessions[0].id,phase:'finished'});
          ledger.recent = ledger.recent.slice(-20);
          continue;
        }
      } catch { /* A failed read is not evidence of completion. */ }
    }
    kept.push(root);
  }
  ledger.roots = kept;
  return kept.length;
}

// A source replay is always blocked, but the wording must match the recorded
// reservation phase: an in-flight or uncertain dispatch was NOT submitted.
function duplicateError(ledger, sourceKey) {
  const reservationId = ledger.sources?.[sourceKey];
  if (!reservationId) return null;
  const root = Array.isArray(ledger.roots)
    ? ledger.roots.find((item) => item.id === reservationId) : null;
  const handle = root?.sessionId ?? root?.requestId ?? reservationId;
  if (root?.phase === 'sending') {
    return new Error(`This message is still pending dispatch to ${handle}. Wait for that Office root before retrying.`);
  }
  if (root?.phase === 'uncertain') {
    return new Error(`This message's dispatch is uncertain at ${handle}. Inspect that Office root before retrying; do not resend.`);
  }
  return new Error('This message was already submitted. Check its Office session before retrying.');
}

export async function dispatch(directory, prompt, options = {}) {
  const run = options.run ?? runOpenCode;
  const inspectFn = options.inspectFn ?? inspect;
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new Error('Select a project directory.');
  }
  if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > MAX_PROMPT) {
    throw new Error(`Choose a message of 1-${MAX_PROMPT} characters.`);
  }

  const dir = await realpath(directory);
  const info = await inspectFn(dir,{run});
  const departments = departmentsFor(info.settings, info.agents);
  let department = null;
  if (options.department) {
    department = options.department;
  } else if (typeof options.departmentId === 'string' && options.departmentId) {
    // An explicit department that is gone is an error, never a silent switch
    // to a different team.
    department = departments.find((item) => item.id === options.departmentId) ?? null;
    if (!department) throw new Error('That department is not configured. Refresh the Office.');
  }
  const requested = typeof options.agent === 'string' && options.agent
    ? options.agent
    : department?.lead ?? info.settings?.lead ?? null;
  const selection = selectLead(info.agents || [], requested);
  if (selection.nextAction !== 'ready') {
    throw new Error(department && requested === department.lead
      ? `Department lead "${department.lead}" is unavailable. Review the department in Settings.`
      : 'Select a lead agent before dispatching.');
  }
  // Read the journal before creating anything: an unreadable journal must not
  // leave a session with no prompt.
  const lessons = department && options.context !== false
    ? (Array.isArray(options.lessons) ? options.lessons : (await readDepartmentJournal(dir, department.id)).lessons)
    : [];
  const lead = (info.agents || []).find((agent) => (agent.id ?? agent.name) === selection.selected) || {};

  const catalog = await catalogFor(run, dir);
  // An explicitly named agent (an advisor, a department lead invoked directly)
  // runs on its own configured model. The Office-wide leadModel is for
  // "Ask Office lead" and for a department's ordinary dispatch.
  const explicitAgent = typeof options.agent === 'string' && options.agent.length > 0;
  const configured = explicitAgent ? null : parseModel(info.settings?.leadModel);
  if (!explicitAgent && info.settings?.leadModel != null && !configured) throw new Error('Invalid leadModel.');
  const agentRef = agentModelRef(lead);
  const fallback = configured || agentRef || await hostDefault(run, dir);
  const leadRef = findModel(catalog, fallback);
  if (!leadRef) {
    throw new Error('Configure leadModel as provider/model or use an agent or host default.');
  }

  const cost = modelCost(leadRef);
  const budget = info.settings?.budget;
  const finiteBudget = budget != null;
  if (finiteBudget && (!Number.isFinite(budget) || budget < 0)) throw new Error('Invalid budget.');
  if (!cost && finiteBudget) {
    throw new Error('Model cost is unknown with a finite budget; refusing to dispatch.');
  }

  const parallelism = Number(info.settings?.parallelism ?? 1);
  if (parallelism === 0) throw new Error('Office dispatch is paused (parallelism 0).');
  if (!Number.isInteger(parallelism) || parallelism < 1) {
    throw new Error('Parallelism is not configured.');
  }
  const estimatedCost = cost ? (cost.input * INPUT_TOKENS + cost.output * OUTPUT_TOKENS) / 1_000_000 : 0;

  const specialistRef = parseModel(info.settings?.specialistModel);
  if (info.settings?.specialistModel != null && (!specialistRef || !findModel(catalog, specialistRef))) {
    throw new Error('specialistModel is not in the model catalog.');
  }

  const { path: ledgerPath, lock: lockPath } = ledgerPaths(dir);
  if (finiteBudget && estimatedCost > budget) throw new Error('Budget exceeded.');
  // The host cannot constrain models used by descendants. A zero-priced lead
  // does not bound a delegated task, even if a free specialist was requested.
  if (finiteBudget) throw new Error('Finite Office budget: host cannot bound delegated costs. No task sent.');
  await mkdir(join(ledgerPath, '..'), { recursive: true, mode:0o700 });

  const reservationId = randomUUID();
  const requestId = `ses_${reservationId.replaceAll('-','')}`;
  const origin = options.origin;
  if (origin) {
    const source = await hostApi(run)('GET',`/api/session/${encodeURIComponent(origin.sessionId)}`);
    if (source?.id !== origin.sessionId || source?.location?.directory !== dir) throw new Error('Source message belongs to another project or is unavailable.');
  }
  const sourceKey = origin?.sessionId && origin?.messageId ? JSON.stringify([origin.sessionId,origin.messageId]) : null;
  await withLock(lockPath, async () => {
    const ledger = (await readJson(ledgerPath)) ?? { roots: [] };
    if (sourceKey) {
      const duplicate = duplicateError(ledger, sourceKey);
      if (duplicate) throw duplicate;
    }
    const count = await reconcile(run, ledger, dir);
    if (ledger.roots.some(r => r.phase === 'uncertain')) throw new Error('A previous dispatch is uncertain. Check its Office root before retrying.');
    if (count >= parallelism) throw new Error('Parallelism limit reached.');
    if (sourceKey) (ledger.sources ??= {})[sourceKey] = reservationId;
    ledger.roots = ledger.roots || [];
    ledger.roots.push({
      id: reservationId,
      requestId,
      sessionId: null,
      issuedAt: Date.now(),
      lead: selection.selected,
      department: department?.id ?? null,
      model: `${leadRef.providerID}/${leadRef.id}`,
      variant: fallback.variant,
      phase:'sending',
      estimate: cost ? estimatedCost : null,
    });
    await writeJsonAtomic(ledgerPath, ledger);
  });

  let sessionId;
  try {
    const { stdout } = await api(run, [
      'POST',
      '/api/session',
      '--data',
      JSON.stringify({
        id: requestId,
        agent: selection.selected,
        model: fallback,
        ...(origin?.sessionId ? {metadata:{agentOfficeOrigin:origin}} : {}),
        location: { directory: dir },
        title: department ? `Office · ${department.name}: ${prompt.trim().slice(0, 40)}` : `Office: ${prompt.trim().slice(0, 60)}`,
      }),
    ]);
    const created = JSON.parse(stdout)?.data;
    sessionId = created?.id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('Session creation failed.');
    if (created.parentID || created.location?.directory !== dir || created.agent !== selection.selected ||
        created.model?.providerID !== fallback.providerID || created.model?.id !== fallback.id ||
        (fallback.variant && created.model.variant !== fallback.variant)) throw new Error('Host did not confirm the requested lead route.');
  } catch (error) {
    if ([400,401,403,422].includes(error.status) || error.code === 'ENOENT') {
      await withLock(lockPath, async () => {
        const ledger = await readJson(ledgerPath);
        ledger.roots = ledger.roots.filter(r => r.id !== reservationId);
        if (sourceKey) delete ledger.sources[sourceKey];
        await writeJsonAtomic(ledgerPath,ledger);
      });
      throw new Error('The host rejected creation. No prompt sent.');
    }
    await markPhase('uncertain');
    throw new Error(`Session creation is uncertain. Reservation retained; check ${requestId} before retrying.`);
  }

  await withLock(lockPath, async () => {
    const ledger = await readJson(ledgerPath);
    const root = ledger?.roots?.find((item) => item.id === reservationId);
    if (!root) throw new Error(`Lost reservation for ${sessionId}; no prompt sent.`);
    root.sessionId = sessionId;
    await writeJsonAtomic(ledgerPath, ledger);
  });

  let text = prompt.trim();
  if (department && options.context !== false) text = withDepartmentContext(text, department, lessons);
  if (specialistRef) {
    text += `\n\nPreferred specialist model: ${info.settings.specialistModel}. This preference is not enforced by the host.`;
  }
  async function markPhase(phase) {
    await withLock(lockPath, async () => {
      const ledger = await readJson(ledgerPath);
      ledger.roots.find(r => r.id === reservationId).phase = phase;
      await writeJsonAtomic(ledgerPath,ledger);
    });
  }
  try { const {stdout} = await api(run, [
    'POST',
    `/api/session/${encodeURIComponent(sessionId)}/prompt`,
    '--data',
    JSON.stringify({ text }),
  ]); if (JSON.parse(stdout)?.data?.sessionID !== sessionId) throw new Error();
  } catch { await markPhase('uncertain'); throw new Error(`Delivery uncertain for ${sessionId}; do not resend. Inspect this root first.`); }
  await markPhase('submitted');

  return {
    sessionId,
    rootId: sessionId,
    lead: selection.selected,
    requestedLeadModel: `${leadRef.providerID}/${leadRef.id}${fallback.variant ? `#${fallback.variant}` : ''}`,
    preferredSpecialistModel: info.settings?.specialistModel ?? null,
    directory: dir,
  };
}
