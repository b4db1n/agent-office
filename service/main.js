// service/main.ts
import http from "node:http";
import { isAbsolute as isAbsolute2 } from "node:path";

// shared/settings.mjs
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
var SETTINGS_KEYS = Object.freeze([
  "lead",
  "leadModel",
  "specialistModel",
  "agentModels",
  "language",
  "appearance",
  "notifications",
  "visibleControls",
  "parallelism",
  "budget"
]);
var DEFAULT_SETTINGS = Object.freeze(Object.fromEntries(SETTINGS_KEYS.map((key) => [key, null])));
var STATE_CANDIDATES = [
  path.join(homedir(), ".config", "agent-office", "settings.json"),
  path.join(homedir(), ".config", "openchamber", "agent-office.json"),
  path.join(homedir(), ".agent-office", "settings.json")
];
function stateFile() {
  if (process.env.AGENT_OFFICE_SETTINGS_FILE)
    return process.env.AGENT_OFFICE_SETTINGS_FILE;
  return STATE_CANDIDATES[0];
}
function emptyState() {
  return { version: 1, global: { ...DEFAULT_SETTINGS }, projects: {} };
}
async function readState() {
  for (const file of [stateFile(), ...STATE_CANDIDATES]) {
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (!parsed.global || typeof parsed.global !== "object" || Array.isArray(parsed.global))
          parsed.global = {};
        if (!parsed.projects || typeof parsed.projects !== "object" || Array.isArray(parsed.projects))
          parsed.projects = {};
        return parsed;
      }
    } catch {}
  }
  return emptyState();
}
function normalizeScopeSettings(value) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  for (const key of SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      result[key] = value[key];
    }
  }
  return result;
}
function validateValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("Settings values must be an object.");
  }
  const unknown = Object.keys(values).filter((key) => !SETTINGS_KEYS.includes(key));
  if (unknown.length)
    throw new Error(`Unknown settings key: ${unknown.join(", ")}.`);
  const out = {};
  for (const key of Object.keys(values)) {
    const value = values[key];
    if (value === null) {
      out[key] = null;
      continue;
    }
    switch (key) {
      case "lead":
      case "leadModel":
      case "specialistModel":
      case "language":
      case "appearance":
        if (typeof value !== "string")
          throw new Error(`${key} must be a string or null.`);
        out[key] = value;
        break;
      case "agentModels":
        if (typeof value !== "object" || Array.isArray(value))
          throw new Error(`${key} must be an object or null.`);
        out[key] = value;
        break;
      case "notifications":
        if (typeof value !== "boolean" && !(typeof value === "object" && !Array.isArray(value))) {
          throw new Error(`${key} must be a boolean, object, or null.`);
        }
        out[key] = value;
        break;
      case "visibleControls":
        if (!Array.isArray(value) && !(typeof value === "object" && value !== null)) {
          throw new Error(`${key} must be an array, object, or null.`);
        }
        out[key] = value;
        break;
      case "parallelism":
      case "budget":
        if (typeof value !== "number" || !Number.isFinite(value))
          throw new Error(`${key} must be a number or null.`);
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
      result[key] = "host";
    } else if (Object.prototype.hasOwnProperty.call(project, key)) {
      result[key] = "project";
    } else if (Object.prototype.hasOwnProperty.call(global, key)) {
      result[key] = "global";
    } else {
      result[key] = "host";
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
  const args = ["api", method.toUpperCase(), endpoint];
  if (body !== undefined)
    args.push("--data", JSON.stringify(body));
  const stdout = execFileSync("opencode", args, {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(stdout);
}
async function warmLocation(directory) {
  let sessionId = null;
  try {
    const created = apiCall("POST", "/api/session", {
      location: { directory },
      title: "Agent Office discovery"
    });
    sessionId = created?.data?.id ?? null;
    for (let attempt = 0;attempt < 24; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const agents = await apiGet("/api/agent", directory);
      if (Array.isArray(agents?.data) && agents.data.length > 0)
        return agents;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (sessionId) {
      try {
        apiCall("DELETE", `/api/session/${encodeURIComponent(sessionId)}`);
      } catch {}
    }
  }
}
async function apiGet(endpoint, directory) {
  const url = addLocation(endpoint, directory);
  let lastError = null;
  for (let attempt = 0;attempt < 2; attempt += 1) {
    try {
      const stdout = execFileSync("opencode", ["api", "get", url], {
        encoding: "utf8",
        timeout: 30000,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const parsed = JSON.parse(stdout);
      if (!parsed || typeof parsed !== "object" || !parsed.location || !sameDirectory(parsed.location.directory, directory)) {
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
  if (!agent || typeof agent !== "object" || Array.isArray(agent))
    return agent;
  const copy = { ...agent };
  for (const key of Object.keys(copy)) {
    if (key.toLowerCase().includes("prompt"))
      delete copy[key];
  }
  return copy;
}
async function settingsView(directory) {
  const state = await readState();
  const global = normalizeScopeSettings(state.global);
  const project = normalizeScopeSettings(state.projects && state.projects[directory]);
  return {
    settings: effectiveSettings(project, global),
    sources: sourcesFor(project, global),
    project,
    global
  };
}
async function inspect(directory) {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("A project directory is required.");
  }
  let agentResponse = await apiGet("/api/agent", directory);
  if (!Array.isArray(agentResponse?.data) || agentResponse.data.length === 0) {
    agentResponse = await warmLocation(directory);
  }
  const modelResponse = await apiGet("/api/model", directory);
  const pluginResponse = await apiGet("/api/plugin", directory);
  const agents = Array.isArray(agentResponse?.data) ? agentResponse.data.map(sanitizeAgent) : [];
  const models = Array.isArray(modelResponse?.data) ? modelResponse.data.filter((model) => model && model.enabled === true).map((model) => `${model.providerID}/${model.id}`) : [];
  const seenModels = new Set;
  const uniqueModels = [];
  for (const model of models) {
    if (seenModels.has(model))
      continue;
    seenModels.add(model);
    uniqueModels.push(model);
  }
  const view = await settingsView(directory);
  let plugin = null;
  if (pluginResponse && pluginResponse.location && pluginResponse.location.directory === directory) {
    const list = Array.isArray(pluginResponse.data) ? pluginResponse.data : [];
    plugin = list.some((item) => {
      if (!item || typeof item !== "object")
        return false;
      if (item.id === "agent-office")
        return true;
      const source = item.source;
      if (source && typeof source === "object") {
        const text = JSON.stringify(source);
        if (text.includes("agent-office"))
          return true;
      }
      return false;
    });
  }
  return {
    agents,
    models: uniqueModels,
    ...view,
    plugin
  };
}
async function saveSettings(directory, scope, values) {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("A project directory is required.");
  }
  if (scope !== "global" && scope !== "project") {
    throw new Error('Settings scope must be "global" or "project".');
  }
  const validated = validateValues(values || {});
  const state = await readState();
  if (!state.global || typeof state.global !== "object" || Array.isArray(state.global))
    state.global = {};
  if (!state.projects || typeof state.projects !== "object" || Array.isArray(state.projects))
    state.projects = {};
  if (scope === "global") {
    state.global = { ...state.global, ...validated };
  } else {
    const current = state.projects[directory];
    const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    state.projects[directory] = { ...base, ...validated };
  }
  const file = stateFile();
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const payload = JSON.stringify(state, null, 2) + `
`;
  await writeFile(temp, payload, "utf8");
  await rename(temp, file);
  return true;
}

// shared/dispatch.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir as mkdir2, readFile as readFile2, writeFile as writeFile2, rename as rename2, rm, open as openFile, realpath } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { join, isAbsolute } from "node:path";
import { createHash, randomUUID as randomUUID2 } from "node:crypto";

// shared/setup.mjs
var LEAD_NEXT_ACTION = Object.freeze({
  READY: "ready",
  CHOOSE_LEAD: "choose-lead",
  NO_CANDIDATES: "no-candidates"
});
var PRIMARY_MODES = new Set(["primary", "all", undefined, null, ""]);
function normalizeId(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (value && typeof value === "object") {
    return normalizeId(value.id ?? value.name ?? value.key ?? value.agent);
  }
  return null;
}
function normalizeAgents(agents) {
  if (!agents || typeof agents !== "object")
    return [];
  const entries = Array.isArray(agents) ? agents.map((agent) => [normalizeId(agent), agent]) : Object.entries(agents).map(([key, agent]) => [normalizeId(key) ?? normalizeId(agent), agent]);
  const seen = new Set;
  const result = [];
  for (const [id, agent] of entries) {
    if (id === null || seen.has(id))
      continue;
    seen.add(id);
    result.push({ id, agent: agent && typeof agent === "object" ? agent : {} });
  }
  return result;
}
function isLeadCandidate(agent) {
  const record = agent && typeof agent === "object" ? agent : {};
  if (record.hidden === true)
    return false;
  if (record.subagentOnly === true || record.subagent === true)
    return false;
  if (record.mode !== undefined && !PRIMARY_MODES.has(record.mode))
    return false;
  return true;
}
function selectLead(agents, selected) {
  const candidates = normalizeAgents(agents);
  const available = candidates.filter((entry) => isLeadCandidate(entry.agent)).map((entry) => entry.id);
  const requested = normalizeId(selected);
  if (requested !== null && available.includes(requested)) {
    return { selected: requested, available, nextAction: LEAD_NEXT_ACTION.READY };
  }
  if (available.length === 0) {
    return { selected: null, available, nextAction: LEAD_NEXT_ACTION.NO_CANDIDATES };
  }
  return { selected: null, available, nextAction: LEAD_NEXT_ACTION.CHOOSE_LEAD };
}
var SETUP_PROMPT = [
  "Set up Agent Office in this project. Use the installed Agent Office companion. If it is unavailable, explain how to install it before making changes.",
  "",
  "1. DISCOVERY (read only)",
  "   - Inspect the live OpenCode agent and model lists in this directory. Show the current Office settings and their sources.",
  "   - Identify a lead candidate (a visible, top-level-capable agent) plus optional implementer and reviewer agents.",
  "   - If no lead is selected or its ID is missing, offer an available primary agent or preview an optional starter lead. Do not silently substitute one.",
  "   - Record what already exists so you do not duplicate it.",
  "",
  "2. PREVIEW (no writes)",
  "   - Run the installer in preview mode. Show exact paths, skipped existing definitions, the proposed lead, and lower-cost specialist models from the host catalog.",
  "   - Ask the user to select the lead and specialist model, or explicitly keep the host default.",
  "   - Wait for confirmation before writing anything.",
  "",
  "3. SETUP (idempotent)",
  "   - Apply only the approved project settings and missing optional templates. Never overwrite an existing definition or change global defaults.",
  "   - Preview a second time and verify existing files are unchanged.",
  "   - Persist the lead id exactly as validated. Re-running must produce the same result with no duplicates.",
  "",
  "4. SMOKE (verify)",
  "   - Dispatch one small agreed task through Agent Office using the selected lead and a real specialist. Have the lead verify the resulting file or check.",
  "   - Inspect the team under that root. Report the actual parent/child relationship, observed models, and verification result; distinguish missing evidence from success.",
  "   - Report the files touched and the checks run. Do not commit unless explicitly asked."
].join(`
`);

// shared/dispatch.mjs
var run = promisify(execFile);
function defaultRun() {
  return run;
}
var MAX_PROMPT = 32000;
var INPUT_TOKENS = 4000;
var OUTPUT_TOKENS = 4000;
function api(run, args) {
  return run("opencode", ["api", ...args]);
}
async function readJson(path) {
  try {
    return JSON.parse(await readFile2(path, "utf8"));
  } catch {
    return null;
  }
}
async function writeJsonAtomic(path, value) {
  const temp = `${path}.${process.pid}.${randomUUID2()}.tmp`;
  await writeFile2(temp, JSON.stringify(value, null, 2) + `
`, "utf8");
  await rename2(temp, path);
}
async function withLock(lockPath, fn) {
  const started = Date.now();
  while (true) {
    try {
      const handle = await openFile(lockPath, "wx");
      await handle.close();
      break;
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
      if (Date.now() - started > 1e4)
        throw new Error("Could not acquire the dispatch lock.");
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
  const base = process.env.XDG_STATE_HOME || join(homedir2(), ".local", "state");
  return join(base, "agent-office", "ledgers");
}
function ledgerPaths(directory) {
  const key = createHash("sha256").update(directory).digest("hex").slice(0, 24);
  const path = join(stateDir(), `${key}.json`);
  return { path, lock: `${path}.lock` };
}
function parseModel(value) {
  if (typeof value !== "string")
    return null;
  const text = value.trim();
  const at = text.lastIndexOf("/");
  if (at <= 0 || at === text.length - 1)
    return null;
  const providerID = text.slice(0, at);
  const id = text.slice(at + 1);
  if (/\s/.test(providerID) || /\s/.test(id))
    return null;
  return { id, providerID };
}
function agentModelRef(agent) {
  const value = agent?.model;
  if (!value || typeof value !== "object")
    return null;
  return parseModel(`${value.providerID}/${value.id ?? value.modelID}`);
}
function findModel(catalog, ref) {
  if (!ref)
    return null;
  return catalog.find((model) => (model.id === ref.id || model.modelID === ref.id) && model.providerID === ref.providerID) || null;
}
function modelCost(model) {
  const entry = Array.isArray(model?.cost) ? model.cost[0] : null;
  if (!entry || typeof entry !== "object")
    return null;
  const input = Number(entry.input);
  const output = Number(entry.output);
  if (!Number.isFinite(input) || !Number.isFinite(output))
    return null;
  return { input, output };
}
async function catalogFor(run, directory) {
  const { stdout } = await api(run, [
    "GET",
    "/api/model",
    "--param",
    `location[directory]=${directory}`
  ]);
  const parsed = JSON.parse(stdout);
  const data = parsed?.data ?? parsed;
  return Array.isArray(data) ? data : [];
}
async function hostDefault(run, directory) {
  try {
    const { stdout } = await api(run, [
      "GET",
      "/api/model/default",
      "--param",
      `location[directory]=${directory}`
    ]);
    const ref = JSON.parse(stdout)?.data;
    return parseModel(`${ref?.providerID}/${ref?.id ?? ref?.modelID}`);
  } catch {
    return null;
  }
}
async function sessionInfo(run, id) {
  try {
    const { stdout } = await api(run, ["GET", `/api/session/${encodeURIComponent(id)}`]);
    return JSON.parse(stdout)?.data ?? null;
  } catch {
    return null;
  }
}
async function activeIds(run) {
  try {
    const { stdout } = await api(run, ["GET", "/api/session/active"]);
    const data = JSON.parse(stdout)?.data ?? {};
    return new Set(Object.keys(data));
  } catch {
    return new Set;
  }
}
async function children(run, rootId) {
  try {
    const { stdout } = await api(run, [
      "GET",
      "/api/session",
      "--param",
      `parentID=${rootId}`,
      "--param",
      "limit=100"
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
  if (!info)
    return true;
  if (typeof info.time?.archived === "number" && info.time.archived > 0)
    return true;
  if (typeof info.outcome === "string" && info.outcome.length > 0 && !active.has(info.id))
    return true;
  return false;
}
async function reconcile(run, ledger, directory) {
  const active = await activeIds(run);
  const roots = Array.isArray(ledger.roots) ? ledger.roots : [];
  const kept = [];
  for (const root of roots) {
    const info = root.sessionId ? await sessionInfo(run, root.sessionId) : null;
    const location = info?.location?.directory;
    if (location && location !== directory)
      continue;
    const kids = root.sessionId ? await children(run, root.sessionId) : [];
    const childActive = kids.some((child) => active.has(child.id));
    const finished = isFinished(info, active) && !childActive;
    const stale = !root.sessionId && Date.now() - (root.issuedAt || 0) > 60000;
    if (finished || stale)
      continue;
    kept.push(root);
  }
  ledger.roots = kept;
  return kept.length;
}
async function dispatch(directory, prompt, options = {}) {
  const run = options.run ?? defaultRun();
  const inspectFn = options.inspectFn ?? inspect;
  if (typeof directory !== "string" || !isAbsolute(directory)) {
    throw new Error("Select a project directory.");
  }
  if (typeof prompt !== "string" || prompt.trim().length === 0 || prompt.length > MAX_PROMPT) {
    throw new Error(`Choose a message of 1-${MAX_PROMPT} characters.`);
  }
  const dir = await realpath(directory);
  const info = await inspectFn(dir);
  const selection = selectLead(info.agents || [], info.settings?.lead ?? null);
  if (selection.nextAction !== "ready") {
    throw new Error("Select a lead agent before dispatching.");
  }
  const lead = (info.agents || []).find((agent) => (agent.id ?? agent.name) === selection.selected) || {};
  const catalog = await catalogFor(run, dir);
  const configured = parseModel(info.settings?.leadModel);
  const agentRef = agentModelRef(lead);
  const fallback = configured || agentRef || await hostDefault(run, dir);
  const leadRef = findModel(catalog, fallback);
  if (!leadRef) {
    throw new Error("Configure leadModel as provider/model or use an agent or host default.");
  }
  const cost = modelCost(leadRef);
  const budget = Number(info.settings?.budget);
  const finiteBudget = Number.isFinite(budget) && budget >= 0;
  if (!cost && finiteBudget) {
    throw new Error("Model cost is unknown with a finite budget; refusing to dispatch.");
  }
  const parallelism = Number(info.settings?.parallelism ?? 1);
  if (!Number.isFinite(parallelism) || parallelism < 1) {
    throw new Error("Parallelism is not configured.");
  }
  const estimatedCost = cost ? (cost.input * INPUT_TOKENS + cost.output * OUTPUT_TOKENS) / 1e6 : 0;
  const specialistRef = parseModel(info.settings?.specialistModel);
  if (specialistRef && !findModel(catalog, specialistRef)) {
    throw new Error("specialistModel is not in the model catalog.");
  }
  const { path: ledgerPath, lock: lockPath } = ledgerPaths(dir);
  await mkdir2(join(ledgerPath, ".."), { recursive: true });
  const reservationId = randomUUID2();
  await withLock(lockPath, async () => {
    const ledger = await readJson(ledgerPath) || { roots: [], spent: 0 };
    const count = await reconcile(run, ledger, dir);
    if (count >= parallelism)
      throw new Error("Parallelism limit reached.");
    if (finiteBudget && Number(ledger.spent || 0) + estimatedCost > budget) {
      throw new Error("Budget exceeded.");
    }
    ledger.roots = ledger.roots || [];
    ledger.roots.push({
      id: reservationId,
      sessionId: null,
      issuedAt: Date.now(),
      lead: selection.selected,
      model: `${leadRef.providerID}/${leadRef.id}`
    });
    ledger.spent = Number(ledger.spent || 0) + estimatedCost;
    await writeJsonAtomic(ledgerPath, ledger);
  });
  let sessionId;
  try {
    const { stdout } = await api(run, [
      "POST",
      "/api/session",
      "--data",
      JSON.stringify({
        agent: selection.selected,
        model: { id: leadRef.id, providerID: leadRef.providerID },
        location: { directory: dir },
        title: `Office: ${prompt.trim().slice(0, 60)}`
      })
    ]);
    const created = JSON.parse(stdout)?.data;
    sessionId = created?.id;
    if (typeof sessionId !== "string" || sessionId.length === 0)
      throw new Error("Session creation failed.");
  } catch (error) {
    await withLock(lockPath, async () => {
      const ledger = await readJson(ledgerPath) || { roots: [], spent: 0 };
      ledger.roots = (ledger.roots || []).filter((root) => root.id !== reservationId);
      await writeJsonAtomic(ledgerPath, ledger);
    }).catch(() => {
      return;
    });
    throw error;
  }
  await withLock(lockPath, async () => {
    const ledger = await readJson(ledgerPath) || { roots: [], spent: 0 };
    const root = (ledger.roots || []).find((item) => item.id === reservationId);
    if (root)
      root.sessionId = sessionId;
    await writeJsonAtomic(ledgerPath, ledger);
  }).catch(() => {
    return;
  });
  let text = prompt.trim();
  if (specialistRef) {
    text += `

When delegating to child agents or specialists, use model ${specialistRef.providerID}/${specialistRef.id} unless the task requires otherwise.`;
  }
  await api(run, [
    "POST",
    `/api/session/${encodeURIComponent(sessionId)}/prompt`,
    "--data",
    JSON.stringify({ text })
  ]);
  return {
    sessionId,
    rootId: sessionId,
    lead: selection.selected,
    leadModel: `${leadRef.providerID}/${leadRef.id}`,
    specialistModel: info.settings?.specialistModel ?? null,
    directory: dir
  };
}

// service/main.ts
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (!token || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Missing service configuration.");
http.createServer(async (req, res) => {
  const reply = (status, body) => res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
  if (req.headers.authorization !== `Bearer ${token}`)
    return void reply(401, {});
  if (req.method === "GET" && req.url === "/health")
    return void reply(200, { ok: true });
  if (req.method !== "POST" || !["/inspect", "/settings", "/dispatch"].includes(req.url ?? ""))
    return void reply(404, {});
  try {
    const chunks = [];
    let size = 0;
    for await (const part of req) {
      if ((size += part.length) > 131072)
        return void reply(413, { message: "Request too large." });
      chunks.push(part);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof data?.directory !== "string" || !isAbsolute2(data.directory))
      throw new Error("Select a project directory.");
    if (req.url === "/inspect")
      return void reply(200, await inspect(data.directory));
    if (req.url === "/settings") {
      if (!["project", "global"].includes(data.scope))
        throw new Error("Unknown settings scope.");
      await saveSettings(data.directory, data.scope, data.values);
      return void reply(200, await inspect(data.directory));
    }
    if (typeof data.prompt !== "string" || !data.prompt.trim() || data.prompt.length > 32000)
      throw new Error("Choose a message of 1–32,000 characters.");
    return void reply(200, await dispatch(data.directory, data.prompt));
  } catch (error) {
    return void reply(400, { message: error instanceof Error ? error.message.slice(0, 300) : "Request failed." });
  }
}).listen(port, "127.0.0.1");
