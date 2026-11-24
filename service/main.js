// service/main.ts
import http from "node:http";
import { isAbsolute as isAbsolute2 } from "node:path";
import { realpath as realpath4 } from "node:fs/promises";

// shared/settings.mjs
import { mkdir, open as open2, readFile, rename, realpath, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir as homedir2 } from "node:os";
import path from "node:path";

// shared/host.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var exec = promisify(execFile);
var resolving;
async function runOpenCode(command, args, options = {}) {
  let server = process.env.AGENT_OFFICE_SERVER || process.env.OPENCODE_HOST;
  let env = process.env;
  if (!server) {
    resolving ??= exec(command, ["service", "status"], { encoding: "utf8", timeout: 3000 }).then(({ stdout }) => stdout.trim()).finally(() => {
      resolving = undefined;
    });
    server = await resolving;
    const url = new URL(server);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      throw new Error("Unrecognized local service address.");
    const record = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "opencode", "service.json");
    const file = await open(record, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = await file.stat();
      if (!st.isFile() || st.mode & 63 || process.getuid && st.uid !== process.getuid())
        throw new Error("Invalid local service registration.");
      const entry = JSON.parse(await file.readFile("utf8"));
      if (entry.url !== server || typeof entry.password !== "string")
        throw new Error("OpenCode service changed; retry discovery.");
      env = { ...env, OPENCODE_PASSWORD: entry.password };
    } finally {
      await file.close();
    }
  }
  if (!/^https?:\/\/[^\s]+$/.test(server))
    throw new Error("No running OpenCode host. Open the project and retry.");
  const hostArgs = ["--server", server, ...args];
  return exec(command, hostArgs, {
    encoding: "utf8",
    timeout: 8000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
    env
  });
}
function officeError(error) {
  if (error?.cmd || error?.stderr || error?.stdout)
    return "OpenCode did not complete the request. Check the Office before retrying.";
  if (error?.code === "ENOENT" || error?.code === "ENOTDIR")
    return "The selected project folder is not available.";
  return typeof error?.message === "string" ? error.message.slice(0, 240) : "Office Steward could not complete the request.";
}

// shared/departments.mjs
var DEPARTMENT_MAX = 8;
var MEMBER_MAX = 20;
var LESSON_MAX = 200;
var LESSONS_PER_TASK = 6;
var LESSONS_PER_REVIEW = 3;
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function words(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function departmentId(value) {
  return String(value ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}
function primaryAgents(agents) {
  const list = Array.isArray(agents) ? agents : isRecord(agents) ? Object.values(agents) : [];
  return list.filter((agent) => agent && typeof agent.id === "string" && agent.hidden !== true && agent.subagentOnly !== true && agent.subagent !== true && (agent.mode === undefined || agent.mode === "primary" || agent.mode === "all"));
}
function normalizeDepartments(value) {
  if (value === null || value === undefined)
    return null;
  if (!Array.isArray(value))
    throw new Error("Departments must be a list.");
  if (value.length > DEPARTMENT_MAX)
    throw new Error(`At most ${DEPARTMENT_MAX} departments.`);
  const seen = new Set;
  return value.map((entry, index) => {
    if (!isRecord(entry))
      throw new Error(`Department ${index + 1} must be an object.`);
    const name = words(entry.name, 40);
    if (!name)
      throw new Error(`Department ${index + 1} needs a name.`);
    const id = departmentId(entry.id || name);
    if (!id)
      throw new Error(`Department ${index + 1} needs an id.`);
    if (seen.has(id))
      throw new Error(`Department id "${id}" appears twice.`);
    seen.add(id);
    const lead = words(entry.lead, 64);
    if (!lead)
      throw new Error(`Department "${name}" needs a lead agent.`);
    const members = Array.isArray(entry.members) ? [...new Set(entry.members.filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim()))] : [];
    if (members.length > MEMBER_MAX)
      throw new Error(`Department "${name}" has too many members.`);
    return { id, name, purpose: words(entry.purpose, 160), lead, members };
  });
}
function departmentsFor(settings, agents) {
  const saved = normalizeDepartments(settings?.departments);
  if (saved && saved.length)
    return saved;
  const lead = typeof settings?.lead === "string" ? settings.lead.trim() : "";
  if (!lead)
    return [];
  const candidates = primaryAgents(agents).map((agent) => agent.id);
  return [{
    id: "office",
    name: "Office",
    purpose: "The default team for this project.",
    lead,
    members: candidates.filter((id) => id !== lead)
  }];
}
function lessonTexts(lessons, limit = LESSONS_PER_TASK) {
  const list = Array.isArray(lessons) ? lessons : [];
  return list.map((lesson) => typeof lesson === "string" ? lesson : lesson?.text).filter((text) => typeof text === "string" && text.trim()).map((text) => text.trim().slice(0, LESSON_MAX)).slice(0, limit);
}
function departmentContext(department, lessons) {
  if (!department)
    return "";
  const lines = [`Office department: ${department.name}${department.purpose ? ` — ${department.purpose}` : ""}`];
  lines.push(`Lead: ${department.lead}${department.members?.length ? ` · Members: ${department.members.join(", ")}` : ""}`);
  const learned = lessonTexts(lessons, LESSONS_PER_TASK);
  if (learned.length) {
    lines.push("What this team learned (carry it into this task):", ...learned.map((text) => `- ${text}`));
  }
  return lines.join(`
`);
}
function withDepartmentContext(prompt, department, lessons) {
  const text = typeof prompt === "string" ? prompt.trim() : "";
  const block = departmentContext(department, lessons);
  return block ? `${text}

—
${block}` : text;
}
function parseLessons(text, max = LESSONS_PER_REVIEW) {
  const out = [];
  const seen = new Set;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = /^\s*lesson\s*:\s*(.+)$/i.exec(line);
    if (!match)
      continue;
    const lesson = match[1].replace(/\s+/g, " ").trim().slice(0, LESSON_MAX);
    if (lesson.length < 10)
      continue;
    const key = lesson.toLowerCase();
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(lesson);
    if (out.length >= max)
      break;
  }
  return out;
}
function reviewPrompt(department, lessons, finished) {
  const work = (Array.isArray(finished) ? finished : []).map((item) => `- ${item.title || item.id} — ${item.label || "outcome unknown"} — ${item.id}`).join(`
`);
  const learned = lessonTexts(lessons, 12);
  return [
    `You are the Office advisor reviewing the ${department.name} department.`,
    department.purpose ? `Purpose: ${department.purpose}` : "",
    `Lead: ${department.lead}${department.members?.length ? ` · Members: ${department.members.join(", ")}` : ""}`,
    "",
    "Finished Office work (host-reported outcomes; completion is not verification):",
    work,
    "",
    learned.length ? "Lessons this team already carries:" : "",
    ...learned.map((text) => `- ${text}`),
    "",
    `Write at most ${LESSONS_PER_REVIEW} lessons this team should carry into its next task.`,
    'Rules: one per line, exactly "LESSON: " followed by at most 200 characters; only from the evidence above; no generic advice; do not repeat an existing lesson.',
    'Then one final line: "VERDICT: " and a short judgement of what the team should do differently.'
  ].filter((line) => line !== "").join(`
`);
}

// shared/setting-keys.mjs
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
  "budget",
  "advisor",
  "departments"
]);
var INACTIVE_SETTINGS = Object.freeze([
  "language",
  "appearance",
  "notifications",
  "visibleControls"
]);

// shared/settings.mjs
var DEFAULT_SETTINGS = Object.freeze(Object.fromEntries(SETTINGS_KEYS.map((key) => [key, null])));
var STATE_CANDIDATES = [
  path.join(homedir2(), ".config", "agent-office", "settings.json"),
  path.join(homedir2(), ".config", "openchamber", "agent-office.json"),
  path.join(homedir2(), ".agent-office", "settings.json")
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
  const files = process.env.AGENT_OFFICE_SETTINGS_FILE ? [stateFile()] : STATE_CANDIDATES;
  for (const file of files) {
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      if (!isRecord2(parsed))
        throw new Error("Invalid Office settings.");
      for (const key of ["global", "projects"]) {
        if (own(parsed, key) && !isRecord2(parsed[key]))
          throw new Error("Invalid settings layer.");
      }
      return { ...parsed, global: parsed.global ?? {}, projects: parsed.projects ?? {} };
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error("Office Steward could not read its saved settings. No changes were made.");
    }
  }
  return emptyState();
}
function isRecord2(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
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
      case "advisor":
        if (typeof value !== "string")
          throw new Error(`${key} must be a string or null.`);
        out[key] = value;
        break;
      case "departments":
        out[key] = normalizeDepartments(value);
        break;
      case "agentModels":
        if (!isRecord2(value) || Object.values(value).some((entry) => entry !== null && (typeof entry !== "string" || !entry.trim()))) {
          throw new Error("Agent model overrides must map agent IDs to provider/model values or null.");
        }
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
        if (key === "parallelism" && (!Number.isInteger(value) || value < 0))
          throw new Error("Parallelism must be a non-negative whole number.");
        if (key === "budget" && value < 0)
          throw new Error("Budget cannot be negative.");
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
  if (isRecord2(project.agentModels)) {
    result.agentModels = { ...isRecord2(global.agentModels) ? global.agentModels : {}, ...project.agentModels };
  }
  return result;
}
function sourcesFor(project, global) {
  const result = {};
  for (const key of SETTINGS_KEYS) {
    if (own(project, key))
      result[key] = project[key] === null ? "project (explicit default)" : "project";
    else if (global[key] != null)
      result[key] = "global";
    else
      result[key] = "host";
  }
  return result;
}
function addLocation(endpoint, directory) {
  return `${endpoint}?location%5Bdirectory%5D=${encodeURIComponent(directory)}`;
}
async function apiGet(run, endpoint, directory) {
  try {
    const { stdout } = await run("opencode", ["api", "get", addLocation(endpoint, directory)], {
      encoding: "utf8",
      timeout: 4500,
      maxBuffer: 8 * 1024 * 1024
    });
    const parsed = JSON.parse(stdout);
    const reported = parsed?.location?.directory;
    if (typeof reported !== "string" || await realpath(reported) !== directory)
      return null;
    return parsed;
  } catch {
    return null;
  }
}
function modelRef(value) {
  const id = value?.id ?? value?.modelID;
  if (typeof id !== "string" || typeof value?.providerID !== "string")
    return null;
  const variant = typeof value.variant === "string" ? value.variant : null;
  return { id, providerID: value.providerID, ...variant ? { variant } : {} };
}
function sanitizeAgent(agent) {
  if (!isRecord2(agent) || typeof (agent.id ?? agent.name) !== "string")
    return null;
  return {
    id: agent.id ?? agent.name,
    ...typeof agent.mode === "string" ? { mode: agent.mode } : {},
    hidden: agent.hidden === true,
    subagentOnly: agent.subagentOnly === true || agent.subagent === true,
    model: modelRef(agent.model)
  };
}
async function settingsView(directory) {
  const canonical = await realpath(directory);
  const state = await readState();
  const global = normalizeScopeSettings(state.global);
  const project = normalizeScopeSettings(state.projects[canonical] ?? state.projects[directory]);
  return {
    settings: effectiveSettings(project, global),
    sources: sourcesFor(project, global),
    project,
    global
  };
}
async function inspect(directory, options = {}) {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("A project directory is required.");
  }
  const canonical = await realpath(directory);
  const run = options.run ?? runOpenCode;
  const [agentResponse, modelResponse, pluginResponse, defaultResponse, view] = await Promise.all([
    apiGet(run, "/api/agent", canonical),
    apiGet(run, "/api/model", canonical),
    apiGet(run, "/api/plugin", canonical),
    apiGet(run, "/api/model/default", canonical),
    settingsView(directory)
  ]);
  const agents = Array.isArray(agentResponse?.data) ? agentResponse.data.map(sanitizeAgent).filter(Boolean) : [];
  const models = Array.isArray(modelResponse?.data) ? modelResponse.data.filter((model) => model?.enabled === true).map(modelRef).filter(Boolean).map(({ providerID, id }) => `${providerID}/${id}`) : [];
  const plugin = Array.isArray(pluginResponse?.data) ? pluginResponse.data.some((item) => item?.id === "agent-office" && item.state?.status === "active") : null;
  return {
    agents,
    models: [...new Set(models)],
    variants: Object.fromEntries((Array.isArray(modelResponse?.data) ? modelResponse.data : []).filter((m) => m?.enabled === true).map((m) => [`${m.providerID}/${m.id}`, (m.variants ?? []).map((v) => v.id)])),
    ...view,
    plugin,
    agentDiscovery: !Array.isArray(agentResponse?.data) ? "unavailable" : agents.length ? "ready" : "empty",
    modelDiscovery: !Array.isArray(modelResponse?.data) ? "unavailable" : models.length ? "ready" : "empty",
    hostModel: modelRef(defaultResponse?.data),
    rates: Object.fromEntries((Array.isArray(modelResponse?.data) ? modelResponse.data : []).filter((m) => m?.enabled === true).map((m) => [`${m.providerID}/${m.id}`, Array.isArray(m.cost) ? m.cost.map(({ input, output, cache, tier }) => ({ input, output, cache, tier })) : null]))
  };
}
async function withSettingsLock(file, fn) {
  const lock = `${file}.lock`;
  let handle;
  for (let attempt = 0;!handle; attempt++) {
    try {
      handle = await open2(lock, "wx", 384);
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
      if (attempt >= 60)
        throw new Error("Office Steward settings are busy. Try again.");
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
async function saveSettings(directory, scope, values, unset = []) {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("A project directory is required.");
  }
  if (scope !== "global" && scope !== "project") {
    throw new Error('Settings scope must be "global" or "project".');
  }
  const validated = validateValues(values || {});
  if (!Array.isArray(unset) || unset.some((key) => !SETTINGS_KEYS.includes(key) || own(validated, key))) {
    throw new Error("Invalid inherited settings selection.");
  }
  const canonical = await realpath(directory);
  const file = stateFile();
  await mkdir(path.dirname(file), { recursive: true, mode: 448 });
  return withSettingsLock(file, async () => {
    const state = await readState();
    const current = scope === "global" ? state.global : state.projects[canonical] ?? state.projects[directory];
    const layer = { ...isRecord2(current) ? current : {}, ...validated };
    for (const key of unset)
      delete layer[key];
    if (scope === "global")
      state.global = layer;
    else
      state.projects[canonical] = layer;
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const payload = JSON.stringify(state, null, 2) + `
`;
    try {
      await writeFile(temp, payload, { encoding: "utf8", mode: 384, flag: "wx" });
      await rename(temp, file);
    } finally {
      await unlink(temp).catch((error) => {
        if (error.code !== "ENOENT")
          throw error;
      });
    }
    return true;
  });
}

// shared/family.mjs
function hostApi(run = runOpenCode) {
  return async (method, path, params = {}, body) => {
    const query = new URLSearchParams(params).toString();
    const args = ["api", method, path + (query ? `?${query}` : "")];
    if (body !== undefined)
      args.push("--data", JSON.stringify(body));
    const { stdout } = await run("opencode", args);
    const response = JSON.parse(stdout);
    if (!Object.hasOwn(response, "data"))
      throw new Error("Incomplete host response.");
    if (params["location[directory]"] && response.location?.directory !== params["location[directory]"]) {
      throw new Error("Host did not confirm the requested directory.");
    }
    if (Array.isArray(response.data) && response.cursor)
      return response;
    return response.data;
  };
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function pageRows(response) {
  if (Array.isArray(response)) {
    return { rows: response, next: null, explicitEnd: false, malformedCursor: false };
  }
  if (isObject(response) && Array.isArray(response.data)) {
    const cursor = response.cursor;
    const hasNext = isObject(cursor) && Object.hasOwn(cursor, "next");
    if (hasNext && cursor.next === null) {
      return { rows: response.data, next: null, explicitEnd: true, malformedCursor: false };
    }
    if (cursor === undefined || cursor === null || !isObject(cursor) || !hasNext) {
      return {
        rows: response.data,
        next: null,
        explicitEnd: false,
        malformedCursor: cursor !== undefined && cursor !== null && !isObject(cursor)
      };
    }
    const next = cursor.next;
    if (typeof next === "string" && next) {
      return { rows: response.data, next, explicitEnd: false, malformedCursor: false };
    }
    return { rows: response.data, next: null, explicitEnd: false, malformedCursor: true };
  }
  return null;
}
async function collectPages(api, path, params, options = {}) {
  const maxPages = Number.isFinite(options.maxPages) && options.maxPages > 0 ? options.maxPages : 20;
  const rows = [];
  const cursors = new Set;
  let next = null, pages = 0, read = 0;
  let partial = false, capped = false, tailExplicitEnd = false, tailRows = 0;
  while (pages < maxPages) {
    const callParams = { ...params };
    if (next)
      callParams.cursor = next;
    let response;
    try {
      response = await api("GET", path, callParams);
    } catch {
      partial = true;
      break;
    }
    const page = pageRows(response);
    if (!page) {
      partial = true;
      break;
    }
    read++;
    tailExplicitEnd = page.explicitEnd;
    tailRows = page.rows.length;
    rows.push(...page.rows);
    pages++;
    if (page.malformedCursor) {
      partial = true;
      break;
    }
    if (!page.next) {
      next = null;
      break;
    }
    if (cursors.has(page.next)) {
      partial = true;
      next = null;
      break;
    }
    cursors.add(page.next);
    next = page.next;
  }
  if (next) {
    partial = true;
    capped = true;
  }
  const pageSize = Number(params.limit) || 100;
  const ambiguousTail = tailRows >= pageSize && !tailExplicitEnd;
  return { rows, pages, read, partial, capped, ambiguousTail, tailExplicitEnd, tailRows };
}
function isForeign(child, root, directory) {
  const project = child.projectID;
  if (typeof project === "string" && project && project !== root.projectID)
    return true;
  const dir = child.location?.directory;
  if (typeof dir === "string" && dir && dir !== directory)
    return true;
  return false;
}
async function family(api, directory, rootId, limit = 200) {
  const root = await api("GET", `/api/session/${encodeURIComponent(rootId)}`);
  if (!isObject(root) || root.id !== rootId || root.location?.directory !== directory || !root.projectID) {
    throw new Error("Session is unavailable or outside this project.");
  }
  const sessions = [root], seen = new Set([root.id]);
  let partial = false;
  for (const parent of sessions) {
    const page = await collectPages(api, "/api/session", { parentID: parent.id, directory, limit: 100 });
    partial ||= page.partial || page.ambiguousTail;
    for (const child of page.rows) {
      if (!isObject(child)) {
        partial = true;
        continue;
      }
      if (isForeign(child, root, directory))
        continue;
      if (child.parentID !== parent.id || child.projectID !== root.projectID || child.location?.directory !== directory || !child.id) {
        partial = true;
        continue;
      }
      if (seen.has(child.id))
        continue;
      if (sessions.length >= limit) {
        partial = true;
        break;
      }
      seen.add(child.id);
      sessions.push(child);
    }
  }
  return { sessions, partial };
}

// shared/dispatch.mjs
import { mkdir as mkdir3, readFile as readFile3, writeFile as writeFile3, rename as rename3, rm, open as openFile, realpath as realpath3 } from "node:fs/promises";
import { homedir as homedir4 } from "node:os";
import { join as join2, isAbsolute } from "node:path";
import { createHash, randomUUID as randomUUID3 } from "node:crypto";

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
var OFFICE_REPO_URL = "https://github.com/b4db1n/office-steward";
var PREVIEW_COMMAND = '(d="$HOME/.config/openchamber/extensions/agent-office"; test -f "$d/shared/family.mjs" && node "$d/companion/setup.mjs" --templates --plugin)';
var SETUP_HELP = [
  "Office Steward setup - preview by default; no project changes without --apply.",
  "",
  "From the target project, preview with one command:",
  PREVIEW_COMMAND,
  "",
  "Companion options (node <checkout>/companion/setup.mjs):",
  "  (none)          Preview only: paths, observed lead, models, skipped files.",
  "  --apply         Perform only the approved changes (exclusive create).",
  "  --templates     Include the optional lead/implementer/reviewer definitions.",
  "  --plugin        Include the optional project-local OpenCode plugin.",
  "  --lead ID       Check a candidate lead; does not save your choice.",
  "  --help, -h      Show this help.",
  "",
  "Prerequisites: Node.js and OpenCode 2 (`opencode` on PATH).",
  `Install in OpenChamber from ${OFFICE_REPO_URL}; no local file selection is needed.`
].join(`
`);
var SETUP_PROMPT = [
  "Set up Office Steward in this project. Work from the current project directory. Do not ask me to choose a file or folder at any step.",
  "",
  "0. PREREQUISITES AND COMPANION",
  "   - Check that `node` and `opencode` (OpenCode 2) are on PATH. If either is missing, state that prerequisite and stop before any write.",
  "   - Find the installed companion yourself: resolve `command -v office-steward`, or check `~/.config/openchamber/extensions/agent-office` and `~/.local/share/agent-office/checkout` for `companion/setup.mjs`. Verify the package name and Git origin. Do not search unrelated project folders.",
  `   - If missing, stop at the GitHub install link: ${OFFICE_REPO_URL}. Do not clone or install on my behalf. If only the old companion without shared/family.mjs is present, stop: its inspect may create a chat.`,
  "",
  "1. DISCOVERY (read only)",
  "   - Run the companion CLI `inspect` from this directory. If OpenCode has not loaded the project, tell me how to retry without creating a disposable chat.",
  "   - Record the exact lead id and candidate ids with their mode and hidden flags, the exact model ids from the host catalog, and the current Office settings with their sources. Quote ids as reported; never rename or substitute one.",
  "   - Inspect existing project definitions and plugin paths and report what already exists, so nothing is duplicated or overwritten.",
  "   - If no lead is selected or its id is missing/hidden, list the observed candidates and ask me to pick one, or offer to preview a starter lead. Never silently substitute another agent.",
  "",
  "2. PREVIEW (no writes)",
  "   - Run the companion setup with `--templates --plugin` and without `--apply`. Show exact target paths, skipped existing definitions, the observed lead id, and the observed lower-cost specialist model ids from the catalog.",
  "   - Ask me to confirm the lead and specialist model, or to explicitly keep the host default. Stop here until I approve the complete set of changes. No file may be written before that approval.",
  "",
  "3. SETUP (only after complete approval, idempotent)",
  "   - Apply only the approved project settings and missing optional files. Include the optional templates and/or project-local plugin only if I approved those pieces.",
  "   - Use exclusive create: never overwrite an existing definition, never replace a host-provided agent, never change global defaults.",
  "   - Preview again and verify existing definitions are unchanged and no duplicates were added. Persist the lead id exactly as validated. Re-running must produce the same result.",
  "",
  "4. SMOKE (safe, no paid models)",
  "   - Dispatch one small agreed task only with model ids I have confirmed are free for this session. If no free model is confirmed, skip the smoke and say why; never run a model of unknown or paid cost.",
  "   - Have the lead verify the result with a local check (a new file or an assertion). Inspect the team under that root and report the actual parent/child relationship, the observed lead and models, and the verification result. Distinguish missing evidence from success.",
  "   - Report the files touched and the checks run. Do not commit unless explicitly asked."
].join(`
`);

// shared/lessons.mjs
import { mkdir as mkdir2, open as open3, readFile as readFile2, realpath as realpath2, rename as rename2, unlink as unlink2, writeFile as writeFile2 } from "node:fs/promises";
import { randomUUID as randomUUID2 } from "node:crypto";
import { homedir as homedir3 } from "node:os";
import path2 from "node:path";
var MAX_LESSONS = 20;
var MAX_REVIEWS = 12;
function isRecord3(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function journalFile() {
  return process.env.AGENT_OFFICE_LESSONS_FILE || path2.join(homedir3(), ".config", "agent-office", "lessons.json");
}
function emptyStore() {
  return { version: 1, projects: {} };
}
async function readStore() {
  try {
    const parsed = JSON.parse(await readFile2(journalFile(), "utf8"));
    if (!isRecord3(parsed) || !isRecord3(parsed.projects ?? {}))
      throw new Error("invalid");
    return { version: 1, ...parsed, projects: isRecord3(parsed.projects) ? parsed.projects : {} };
  } catch (error) {
    if (error.code === "ENOENT")
      return emptyStore();
    throw new Error("The Office journal is unreadable. No changes were made.");
  }
}
async function withLock(file, fn) {
  const lock = `${file}.lock`;
  let handle;
  for (let attempt = 0;!handle; attempt++) {
    try {
      handle = await open3(lock, "wx", 384);
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
      if (attempt >= 40)
        throw new Error("The Office journal is busy. Try again.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink2(lock).catch(() => {
      return;
    });
  }
}
async function mutate(fn) {
  const file = journalFile();
  await mkdir2(path2.dirname(file), { recursive: true, mode: 448 });
  return withLock(file, async () => {
    const store = await readStore();
    const result = await fn(store);
    const temp = `${file}.${process.pid}.${randomUUID2()}.tmp`;
    try {
      await writeFile2(temp, JSON.stringify(store, null, 2) + `
`, { encoding: "utf8", mode: 384, flag: "wx" });
      await rename2(temp, file);
    } finally {
      await unlink2(temp).catch((error) => {
        if (error.code !== "ENOENT")
          throw error;
      });
    }
    return result;
  });
}
function projectEntry(store, key, create) {
  if (!isRecord3(store.projects[key])) {
    if (!create)
      return null;
    store.projects[key] = { departments: {} };
  }
  const project = store.projects[key];
  if (!isRecord3(project.departments)) {
    if (!create)
      return null;
    project.departments = {};
  }
  return project;
}
function departmentEntry(project, id, create) {
  if (!isRecord3(project.departments[id])) {
    if (!create)
      return null;
    project.departments[id] = { lessons: [], reviews: [] };
  }
  const department = project.departments[id];
  if (!Array.isArray(department.lessons))
    department.lessons = [];
  if (!Array.isArray(department.reviews))
    department.reviews = [];
  return department;
}
async function projectKey(directory) {
  if (typeof directory !== "string" || !directory)
    throw new Error("A project directory is required.");
  return realpath2(directory);
}
function cleanDepartmentId(id) {
  if (typeof id !== "string" || !id.trim())
    throw new Error("A department is required.");
  return id.trim();
}
function cleanLesson(text) {
  const lesson = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, LESSON_MAX);
  if (lesson.length < 10)
    throw new Error("A lesson needs at least 10 characters.");
  return lesson;
}
async function readDepartmentJournal(directory, id) {
  const key = await projectKey(directory);
  const department = cleanDepartmentId(id);
  const store = await readStore();
  const project = projectEntry(store, key, false);
  const entry = project ? departmentEntry(project, department, false) : null;
  return {
    lessons: (entry?.lessons ?? []).filter(isRecord3),
    reviews: (entry?.reviews ?? []).filter(isRecord3)
  };
}
async function readProjectJournal(directory) {
  const key = await projectKey(directory);
  const store = await readStore();
  const project = projectEntry(store, key, false);
  const result = {};
  for (const [id, value] of Object.entries(project?.departments ?? {})) {
    if (!isRecord3(value))
      continue;
    result[id] = {
      lessons: (Array.isArray(value.lessons) ? value.lessons : []).filter(isRecord3),
      reviews: (Array.isArray(value.reviews) ? value.reviews : []).filter(isRecord3)
    };
  }
  return result;
}
async function addLessons(directory, id, texts, source) {
  const key = await projectKey(directory);
  const department = cleanDepartmentId(id);
  const lessons = (Array.isArray(texts) ? texts : []).map(cleanLesson);
  if (!lessons.length)
    return { added: [], skipped: 0 };
  const from = typeof source === "string" && source ? source : null;
  return mutate((store) => {
    const project = projectEntry(store, key, true);
    const entry = departmentEntry(project, department, true);
    const seen = new Set(entry.lessons.map((lesson) => String(lesson.text ?? "").toLowerCase()));
    const added = [];
    for (const text of lessons) {
      const dedupe = text.toLowerCase();
      if (seen.has(dedupe))
        continue;
      seen.add(dedupe);
      entry.lessons.push({ id: randomUUID2(), text, source: from, addedAt: Date.now() });
      added.push(text);
    }
    entry.lessons = entry.lessons.slice(-MAX_LESSONS);
    return { added, skipped: lessons.length - added.length };
  });
}
async function recordReview(directory, id, sessionId) {
  const key = await projectKey(directory);
  const department = cleanDepartmentId(id);
  if (typeof sessionId !== "string" || !sessionId)
    throw new Error("A session is required.");
  return mutate((store) => {
    const project = projectEntry(store, key, true);
    const entry = departmentEntry(project, department, true);
    if (!entry.reviews.some((review) => review.sessionId === sessionId)) {
      entry.reviews.push({ sessionId, status: "pending", startedAt: Date.now() });
      entry.reviews = entry.reviews.slice(-MAX_REVIEWS);
    }
  });
}
async function findReview(directory, sessionId) {
  const key = await projectKey(directory);
  if (typeof sessionId !== "string" || !sessionId)
    throw new Error("A session is required.");
  const store = await readStore();
  const project = projectEntry(store, key, false);
  for (const [department, entry] of Object.entries(project?.departments ?? {})) {
    if (!isRecord3(entry) || !Array.isArray(entry.reviews))
      continue;
    const review = entry.reviews.find((item) => isRecord3(item) && item.sessionId === sessionId);
    if (review)
      return { department, review };
  }
  return null;
}
async function updateReview(directory, sessionId, patch) {
  const key = await projectKey(directory);
  if (typeof sessionId !== "string" || !sessionId)
    throw new Error("A session is required.");
  return mutate((store) => {
    const project = projectEntry(store, key, false);
    for (const entry of Object.values(project?.departments ?? {})) {
      if (!isRecord3(entry) || !Array.isArray(entry.reviews))
        continue;
      const review = entry.reviews.find((item) => isRecord3(item) && item.sessionId === sessionId);
      if (!review)
        continue;
      Object.assign(review, isRecord3(patch) ? patch : {}, { updatedAt: Date.now() });
      return true;
    }
    throw new Error("That advisor review is not in the journal.");
  });
}

// shared/dispatch.mjs
var MAX_PROMPT = 32000;
var INPUT_TOKENS = 4000;
var OUTPUT_TOKENS = 4000;
function api(run, args) {
  return run("opencode", ["api", ...args]);
}
async function readJson(path) {
  try {
    return JSON.parse(await readFile3(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    throw new Error("Office admission ledger is unreadable; no task sent.");
  }
}
async function writeJsonAtomic(path, value) {
  const temp = `${path}.${process.pid}.${randomUUID3()}.tmp`;
  await writeFile3(temp, JSON.stringify(value, null, 2) + `
`, { mode: 384, flag: "wx" });
  await rename3(temp, path);
}
async function withLock2(lockPath, fn) {
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
  const base = process.env.XDG_STATE_HOME || join2(homedir4(), ".local", "state");
  return join2(base, "agent-office", "ledgers");
}
function ledgerPaths(directory) {
  const key = createHash("sha256").update(directory).digest("hex").slice(0, 24);
  const path = join2(stateDir(), `${key}.json`);
  return { path, lock: `${path}.lock` };
}
async function admissionView(directory) {
  const ledger = await readJson(ledgerPaths(await realpath3(directory)).path);
  if (ledger && !Array.isArray(ledger.roots))
    throw new Error("Invalid Office ledger.");
  return [...ledger?.recent ?? [], ...ledger?.roots ?? []].map((r) => ({
    rootId: r.sessionId ?? r.requestId ?? null,
    phase: r.phase ?? "legacy",
    estimatedLeadCost: r.estimate ?? null
  }));
}
function parseModel(value) {
  if (typeof value !== "string")
    return null;
  const text = value.trim();
  const at = text.lastIndexOf("/");
  if (at <= 0 || at === text.length - 1)
    return null;
  const providerID = text.slice(0, at);
  const [id, variant, extra] = text.slice(at + 1).split("#");
  if (!id || extra !== undefined || variant === "" || /[\s#]/.test(providerID) || /\s/.test(text))
    return null;
  return { id, providerID, ...variant ? { variant } : {} };
}
function agentModelRef(agent) {
  const value = agent?.model;
  if (!value || typeof value !== "object")
    return null;
  return parseModel(`${value.providerID}/${value.id ?? value.modelID}${value.variant ? `#${value.variant}` : ""}`);
}
function findModel(catalog, ref) {
  if (!ref)
    return null;
  return catalog.find((model) => model.id === ref.id && model.providerID === ref.providerID && model.enabled === true && (!ref.variant || model.variants?.some((v) => v.id === ref.variant))) || null;
}
function modelCost(model) {
  const entry = Array.isArray(model?.cost) ? model.cost[0] : null;
  if (!entry || typeof entry !== "object")
    return null;
  if (model.cost.length !== 1 || entry.tier !== undefined)
    return null;
  const { input, output } = entry;
  if (![input, output].every((n) => Number.isFinite(n) && n >= 0))
    return null;
  return { input, output };
}
async function catalogFor(run, directory) {
  const { stdout } = await api(run, [
    "GET",
    `/api/model?${new URLSearchParams({ "location[directory]": directory })}`
  ]);
  const parsed = JSON.parse(stdout);
  if (parsed?.location?.directory !== directory)
    throw new Error("Model catalog did not confirm the project.");
  const data = parsed?.data;
  return Array.isArray(data) ? data : [];
}
async function hostDefault(run, directory) {
  try {
    const { stdout } = await api(run, [
      "GET",
      `/api/model/default?${new URLSearchParams({ "location[directory]": directory })}`
    ]);
    const response = JSON.parse(stdout);
    if (response?.location?.directory !== directory)
      return null;
    const ref = response.data;
    return ref ? agentModelRef({ model: ref }) : null;
  } catch {
    return null;
  }
}
async function reconcile(run, ledger, directory) {
  if (!Array.isArray(ledger.roots))
    throw new Error("Invalid Office ledger.");
  if (!ledger.roots.length)
    return 0;
  const read = hostApi(run);
  const active = await read("GET", "/api/session/active");
  if (!active || typeof active !== "object" || Array.isArray(active))
    throw new Error("Cannot verify active work.");
  const kept = [];
  for (const root of ledger.roots) {
    if ((root.sessionId || root.requestId) && root.phase !== "sending") {
      try {
        const tree = await family(read, directory, root.sessionId ?? root.requestId);
        if (!tree.partial && tree.sessions.every((s) => !Object.hasOwn(active, s.id) && ["succeeded", "failed", "interrupted"].includes(s.outcome))) {
          (ledger.recent ??= []).push({ sessionId: tree.sessions[0].id, phase: "finished" });
          ledger.recent = ledger.recent.slice(-20);
          continue;
        }
      } catch {}
    }
    kept.push(root);
  }
  ledger.roots = kept;
  return kept.length;
}
function duplicateError(ledger, sourceKey) {
  const reservationId = ledger.sources?.[sourceKey];
  if (!reservationId)
    return null;
  const root = Array.isArray(ledger.roots) ? ledger.roots.find((item) => item.id === reservationId) : null;
  const handle = root?.sessionId ?? root?.requestId ?? reservationId;
  if (root?.phase === "sending") {
    return new Error(`This message is still pending dispatch to ${handle}. Wait for that Office root before retrying.`);
  }
  if (root?.phase === "uncertain") {
    return new Error(`This message's dispatch is uncertain at ${handle}. Inspect that Office root before retrying; do not resend.`);
  }
  return new Error("This message was already submitted. Check its Office session before retrying.");
}
async function dispatch(directory, prompt, options = {}) {
  const run = options.run ?? runOpenCode;
  const inspectFn = options.inspectFn ?? inspect;
  if (typeof directory !== "string" || !isAbsolute(directory)) {
    throw new Error("Select a project directory.");
  }
  if (typeof prompt !== "string" || prompt.trim().length === 0 || prompt.length > MAX_PROMPT) {
    throw new Error(`Choose a message of 1-${MAX_PROMPT} characters.`);
  }
  const dir = await realpath3(directory);
  const info = await inspectFn(dir, { run });
  const departments = departmentsFor(info.settings, info.agents);
  let department = null;
  if (options.department) {
    department = options.department;
  } else if (typeof options.departmentId === "string" && options.departmentId) {
    department = departments.find((item) => item.id === options.departmentId) ?? null;
    if (!department)
      throw new Error("That department is not configured. Refresh the Office.");
  }
  const requested = typeof options.agent === "string" && options.agent ? options.agent : department?.lead ?? info.settings?.lead ?? null;
  const selection = selectLead(info.agents || [], requested);
  if (selection.nextAction !== "ready") {
    throw new Error(department && requested === department.lead ? `Department lead "${department.lead}" is unavailable. Review the department in Settings.` : "Select a lead agent before dispatching.");
  }
  const lessons = department && options.context !== false ? Array.isArray(options.lessons) ? options.lessons : (await readDepartmentJournal(dir, department.id)).lessons : [];
  const lead = (info.agents || []).find((agent) => (agent.id ?? agent.name) === selection.selected) || {};
  const catalog = await catalogFor(run, dir);
  const explicitAgent = typeof options.agent === "string" && options.agent.length > 0;
  const configured = explicitAgent ? null : parseModel(info.settings?.leadModel);
  if (!explicitAgent && info.settings?.leadModel != null && !configured)
    throw new Error("Invalid leadModel.");
  const agentRef = agentModelRef(lead);
  const fallback = configured || agentRef || await hostDefault(run, dir);
  const leadRef = findModel(catalog, fallback);
  if (!leadRef) {
    throw new Error("Configure leadModel as provider/model or use an agent or host default.");
  }
  const cost = modelCost(leadRef);
  const budget = info.settings?.budget;
  const finiteBudget = budget != null;
  if (finiteBudget && (!Number.isFinite(budget) || budget < 0))
    throw new Error("Invalid budget.");
  if (!cost && finiteBudget) {
    throw new Error("Model cost is unknown with a finite budget; refusing to dispatch.");
  }
  const parallelism = Number(info.settings?.parallelism ?? 1);
  if (parallelism === 0)
    throw new Error("Office dispatch is paused (parallelism 0).");
  if (!Number.isInteger(parallelism) || parallelism < 1) {
    throw new Error("Parallelism is not configured.");
  }
  const estimatedCost = cost ? (cost.input * INPUT_TOKENS + cost.output * OUTPUT_TOKENS) / 1e6 : 0;
  const specialistRef = parseModel(info.settings?.specialistModel);
  if (info.settings?.specialistModel != null && (!specialistRef || !findModel(catalog, specialistRef))) {
    throw new Error("specialistModel is not in the model catalog.");
  }
  const { path: ledgerPath, lock: lockPath } = ledgerPaths(dir);
  if (finiteBudget && estimatedCost > budget)
    throw new Error("Budget exceeded.");
  if (finiteBudget)
    throw new Error("Finite Office budget: host cannot bound delegated costs. No task sent.");
  await mkdir3(join2(ledgerPath, ".."), { recursive: true, mode: 448 });
  const reservationId = randomUUID3();
  const requestId = `ses_${reservationId.replaceAll("-", "")}`;
  const origin = options.origin;
  if (origin) {
    const source = await hostApi(run)("GET", `/api/session/${encodeURIComponent(origin.sessionId)}`);
    if (source?.id !== origin.sessionId || source?.location?.directory !== dir)
      throw new Error("Source message belongs to another project or is unavailable.");
  }
  const sourceKey = origin?.sessionId && origin?.messageId ? JSON.stringify([origin.sessionId, origin.messageId]) : null;
  await withLock2(lockPath, async () => {
    const ledger = await readJson(ledgerPath) ?? { roots: [] };
    if (sourceKey) {
      const duplicate = duplicateError(ledger, sourceKey);
      if (duplicate)
        throw duplicate;
    }
    const count = await reconcile(run, ledger, dir);
    if (ledger.roots.some((r) => r.phase === "uncertain"))
      throw new Error("A previous dispatch is uncertain. Check its Office root before retrying.");
    if (count >= parallelism)
      throw new Error("Parallelism limit reached.");
    if (sourceKey)
      (ledger.sources ??= {})[sourceKey] = reservationId;
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
      phase: "sending",
      estimate: cost ? estimatedCost : null
    });
    await writeJsonAtomic(ledgerPath, ledger);
  });
  let sessionId;
  try {
    const { stdout } = await api(run, [
      "POST",
      "/api/session",
      "--data",
      JSON.stringify({
        id: requestId,
        agent: selection.selected,
        model: fallback,
        ...origin?.sessionId ? { metadata: { agentOfficeOrigin: origin } } : {},
        location: { directory: dir },
        title: department ? `Office · ${department.name}: ${prompt.trim().slice(0, 40)}` : `Office: ${prompt.trim().slice(0, 60)}`
      })
    ]);
    const created = JSON.parse(stdout)?.data;
    sessionId = created?.id;
    if (typeof sessionId !== "string" || sessionId.length === 0)
      throw new Error("Session creation failed.");
    if (created.parentID || created.location?.directory !== dir || created.agent !== selection.selected || created.model?.providerID !== fallback.providerID || created.model?.id !== fallback.id || fallback.variant && created.model.variant !== fallback.variant)
      throw new Error("Host did not confirm the requested lead route.");
  } catch (error) {
    if ([400, 401, 403, 422].includes(error.status) || error.code === "ENOENT") {
      await withLock2(lockPath, async () => {
        const ledger = await readJson(ledgerPath);
        ledger.roots = ledger.roots.filter((r) => r.id !== reservationId);
        if (sourceKey)
          delete ledger.sources[sourceKey];
        await writeJsonAtomic(ledgerPath, ledger);
      });
      throw new Error("The host rejected creation. No prompt sent.");
    }
    await markPhase("uncertain");
    throw new Error(`Session creation is uncertain. Reservation retained; check ${requestId} before retrying.`);
  }
  await withLock2(lockPath, async () => {
    const ledger = await readJson(ledgerPath);
    const root = ledger?.roots?.find((item) => item.id === reservationId);
    if (!root)
      throw new Error(`Lost reservation for ${sessionId}; no prompt sent.`);
    root.sessionId = sessionId;
    await writeJsonAtomic(ledgerPath, ledger);
  });
  let text = prompt.trim();
  if (department && options.context !== false)
    text = withDepartmentContext(text, department, lessons);
  if (specialistRef) {
    text += `

Preferred specialist model: ${info.settings.specialistModel}. This preference is not enforced by the host.`;
  }
  async function markPhase(phase) {
    await withLock2(lockPath, async () => {
      const ledger = await readJson(ledgerPath);
      ledger.roots.find((r) => r.id === reservationId).phase = phase;
      await writeJsonAtomic(ledgerPath, ledger);
    });
  }
  try {
    const { stdout } = await api(run, [
      "POST",
      `/api/session/${encodeURIComponent(sessionId)}/prompt`,
      "--data",
      JSON.stringify({ text })
    ]);
    if (JSON.parse(stdout)?.data?.sessionID !== sessionId)
      throw new Error;
  } catch {
    await markPhase("uncertain");
    throw new Error(`Delivery uncertain for ${sessionId}; do not resend. Inspect this root first.`);
  }
  await markPhase("submitted");
  return {
    sessionId,
    rootId: sessionId,
    lead: selection.selected,
    requestedLeadModel: `${leadRef.providerID}/${leadRef.id}${fallback.variant ? `#${fallback.variant}` : ""}`,
    preferredSpecialistModel: info.settings?.specialistModel ?? null,
    directory: dir
  };
}

// shared/cost.mjs
var SOURCE = Object.freeze({
  REPORTED: "reported",
  ESTIMATED: "estimated",
  HOST_CATALOG: "host-catalog",
  UNKNOWN: "unknown",
  TEST_SYNTHETIC: "test-synthetic"
});
var ID_KEYS = Object.freeze([
  "id",
  "stepId",
  "stepID",
  "eventId",
  "eventID",
  "partId",
  "partID",
  "messageId",
  "messageID",
  "key"
]);
function isObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function normalizeInput(input, catalog) {
  let steps = [];
  let hostCatalog = catalog;
  if (Array.isArray(input)) {
    steps = input;
  } else if (isObject2(input)) {
    steps = input.steps ?? input.items ?? input.records ?? input.entries ?? [];
    hostCatalog = input.catalog ?? input.hostCatalog ?? input.models ?? input.pricing ?? catalog;
  }
  if (!Array.isArray(steps))
    steps = [];
  return { steps, hostCatalog: isObject2(hostCatalog) ? hostCatalog : {} };
}
function finiteNonNegative(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "")
      return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}
function firstValue(step, keys) {
  for (const key of keys) {
    if (isObject2(step) && Object.prototype.hasOwnProperty.call(step, key)) {
      const value = step[key];
      if (value !== undefined && value !== null)
        return value;
    }
  }
  return;
}
function stepId(step) {
  if (!isObject2(step))
    return null;
  for (const key of ID_KEYS) {
    const value = step[key];
    if (typeof value === "string" || typeof value === "number") {
      if (String(value).length > 0)
        return String(value);
    }
  }
  return null;
}
function isSynthetic(step) {
  if (!isObject2(step))
    return false;
  if (step.synthetic === true || step.test === true || step.testSynthetic === true)
    return true;
  const source = String(step.source ?? step.kind ?? step.type ?? "").toLowerCase();
  return source.includes("synthetic") || source.includes("test");
}
function reportedCost(step) {
  if (!isObject2(step))
    return null;
  for (const key of ["reportedCost", "cost", "actualCost", "price"]) {
    const value = finiteNonNegative(step[key]);
    if (value !== null)
      return value;
  }
  if (isObject2(step.usage)) {
    const value = finiteNonNegative(step.usage.cost);
    if (value !== null)
      return value;
  }
  return null;
}
function estimateFromCatalog(step, catalog) {
  if (!isObject2(step) || !isObject2(catalog))
    return null;
  const model = firstValue(step, ["model", "modelId", "modelID"]);
  if (model === undefined)
    return null;
  const modelKey = String(model);
  const provider = firstValue(step, ["provider", "providerID", "providerId"]);
  const providerKey = provider === undefined ? null : `${provider}/${modelKey}`;
  const entry = providerKey ? catalog[providerKey] : catalog[modelKey];
  if (!isObject2(entry))
    return null;
  let rates = entry;
  if (Array.isArray(entry.cost)) {
    rates = entry.cost.find((tier) => isObject2(tier) && tier.tier === undefined) ?? null;
  } else if (isObject2(entry.cost)) {
    rates = entry.cost;
  }
  if (!isObject2(rates))
    return null;
  const inputRate = finiteNonNegative(firstValue(rates, ["input", "inputCost", "prompt"]));
  const outputRate = finiteNonNegative(firstValue(rates, ["output", "outputCost", "completion"]));
  if (inputRate === null || outputRate === null)
    return null;
  const tokenBag = isObject2(step.tokens) ? step.tokens : null;
  const usageBag = isObject2(step.usage) ? step.usage : null;
  const inputTokens = finiteNonNegative(firstValue(step, ["inputTokens"]) ?? firstValue(tokenBag ?? {}, ["input"]) ?? firstValue(usageBag ?? {}, ["inputTokens", "input"]));
  const outputTokens = finiteNonNegative(firstValue(step, ["outputTokens"]) ?? firstValue(tokenBag ?? {}, ["output"]) ?? firstValue(usageBag ?? {}, ["outputTokens", "output"]));
  if (inputTokens === null || outputTokens === null)
    return null;
  if (inputTokens === 0 && outputTokens === 0)
    return null;
  let extra = 0;
  for (const key of ["read", "write"]) {
    const count = finiteNonNegative(tokenBag?.cache?.[key] ?? 0);
    const rate = finiteNonNegative(rates.cache?.[key]);
    if (count === null || count > 0 && rate === null)
      return null;
    extra += count * (rate ?? 0);
  }
  const reasoning = finiteNonNegative(tokenBag?.reasoning ?? 0);
  if (reasoning === null)
    return null;
  return (inputTokens * inputRate + (outputTokens + reasoning) * outputRate + extra) / 1e6;
}
function classifyCost(step, catalog = {}) {
  if (isSynthetic(step))
    return { source: SOURCE.TEST_SYNTHETIC, cost: 0 };
  const reported = reportedCost(step);
  if (reported !== null)
    return { source: SOURCE.REPORTED, cost: reported };
  const estimated = estimateFromCatalog(step, catalog);
  if (estimated !== null)
    return { source: SOURCE.ESTIMATED, cost: estimated };
  return { source: SOURCE.UNKNOWN, cost: 0 };
}
function deduplicateSteps(steps) {
  const byId = new Map;
  const anonymous = [];
  for (const step of steps) {
    const id = stepId(step);
    if (id === null) {
      anonymous.push(step);
      continue;
    }
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, step);
      continue;
    }
    const existingIsChild = Boolean(existing.parentId || existing.parentID || existing.child === true);
    const candidateIsChild = Boolean(step.parentId || step.parentID || step.child === true);
    if (candidateIsChild && !existingIsChild)
      byId.set(id, step);
  }
  return [...byId.values(), ...anonymous];
}
function cost(input, catalog) {
  const { steps, hostCatalog } = normalizeInput(input, catalog);
  const deduped = deduplicateSteps(steps);
  const buckets = {
    reported: 0,
    estimated: 0,
    "host-catalog": 0,
    unknown: 0,
    "test-synthetic": 0
  };
  const counts = {
    reported: 0,
    estimated: 0,
    "host-catalog": 0,
    unknown: 0,
    "test-synthetic": 0
  };
  const details = [];
  for (const step of deduped) {
    const { source, cost: value } = classifyCost(step, hostCatalog);
    const label = source === SOURCE.ESTIMATED ? SOURCE.HOST_CATALOG : source;
    buckets[label] = (buckets[label] || 0) + value;
    counts[label] = (counts[label] || 0) + 1;
    if (label === SOURCE.HOST_CATALOG) {
      buckets.estimated += value;
      counts.estimated += 1;
    }
    details.push({ ...step, costSource: label, cost: value });
  }
  const total = buckets.reported + buckets.estimated;
  return {
    total,
    reported: buckets.reported,
    estimated: buckets.estimated,
    "host-catalog": buckets["host-catalog"],
    unknown: buckets.unknown,
    "test-synthetic": buckets["test-synthetic"],
    synthetic: buckets["test-synthetic"],
    counts,
    steps: details,
    deduplicated: deduped.length,
    original: steps.length
  };
}

// shared/usage.mjs
var STATUS = { OK: "ok", NO_DATA: "no-data", PARTIAL: "partial", UNSUPPORTED: "unsupported", INVALID: "invalid" };
function isObject3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function usage(directory, rootId, options = {}) {
  const api = options.api ?? hostApi(options.run);
  const result = {
    directory,
    rootId,
    counts: { reported: 0, estimated: 0, unknown: 0 },
    reported: 0,
    estimated: 0,
    sessions: [],
    observed: [],
    events: 0,
    truncated: false,
    errors: [],
    status: STATUS.INVALID
  };
  if (!directory || !rootId)
    return result;
  let tree;
  try {
    tree = await family(api, directory, rootId, options.maxSessions);
  } catch {
    return { ...result, status: STATUS.UNSUPPORTED, errors: [{ scope: "root", code: "ROOT_UNAVAILABLE" }] };
  }
  const steps = [], observed = new Map;
  const limit = options.messageLimit ?? 100;
  let reads = 0;
  for (const session of tree.sessions) {
    result.sessions.push(session.id);
    const page = await collectPages(api, `/api/session/${encodeURIComponent(session.id)}/message`, { type: "assistant", limit, order: "desc" }, { maxPages: options.maxMessagePages });
    if (!page.read) {
      result.errors.push({ scope: `messages:${session.id}`, code: "MESSAGES_UNAVAILABLE" });
      continue;
    }
    reads++;
    if (page.partial || page.capped || page.ambiguousTail)
      result.truncated = true;
    for (const row of page.rows) {
      if (!isObject3(row)) {
        result.truncated = true;
        continue;
      }
      if (row.type !== "assistant")
        continue;
      if (!row.id) {
        result.truncated = true;
        continue;
      }
      const { agent, model } = row;
      if (agent && model?.id && model.providerID) {
        const item = {
          sessionId: session.id,
          parentId: session.parentID ?? null,
          agent,
          model: `${model.providerID}/${model.id}`,
          variant: model.variant ?? null
        };
        observed.set(JSON.stringify(item), item);
      }
      steps.push({
        id: row.id,
        child: session.id !== rootId,
        providerID: model?.providerID,
        modelID: model?.id,
        cost: row.cost,
        tokens: row.tokens
      });
    }
  }
  const catalog = {};
  if (steps.some((s) => s.cost == null && s.tokens)) {
    try {
      const models = await api("GET", "/api/model", { "location[directory]": directory });
      for (const m of models ?? []) {
        if (m.cost?.length === 1 && m.cost[0].tier === undefined)
          catalog[`${m.providerID}/${m.id}`] = m;
      }
    } catch {
      result.errors.push({ scope: "catalog", code: "CATALOG_UNAVAILABLE" });
    }
  }
  const data = cost(steps, catalog);
  result.observed = [...observed.values()];
  for (const key of Object.keys(result.counts))
    result.counts[key] = data.counts[key];
  result.events = data.deduplicated;
  result.estimated = data.estimated;
  result.reported = data.reported;
  result.truncated ||= tree.partial;
  result.status = !reads ? STATUS.UNSUPPORTED : result.errors.length || data.counts.unknown || result.truncated ? STATUS.PARTIAL : result.events ? STATUS.OK : STATUS.NO_DATA;
  return result;
}

// shared/advisor.mjs
var TERMINAL = new Set(["succeeded", "completed", "failed", "interrupted", "cancelled"]);
function labelFor(session) {
  if (session?.outcome === "failed")
    return "host reported failure";
  if (session?.outcome === "interrupted")
    return "host reported interruption";
  if (session?.outcome)
    return `host reported ${session.outcome}`;
  return "no host outcome";
}
function messageRows(response) {
  if (Array.isArray(response))
    return response;
  if (Array.isArray(response?.data))
    return response.data;
  return [];
}
async function finishedWork(directory, options = {}) {
  const api = hostApi(options.run);
  const reservations = await admissionView(directory);
  const finished = [];
  const seen = new Set;
  for (const row of reservations.slice(-10)) {
    if (!row?.rootId || row.phase !== "finished" || seen.has(row.rootId))
      continue;
    seen.add(row.rootId);
    try {
      const session = await api("GET", `/api/session/${encodeURIComponent(row.rootId)}`, {
        "location[directory]": directory
      });
      if (session?.id !== row.rootId)
        continue;
      finished.push({ id: row.rootId, title: session.title || row.rootId, label: labelFor(session) });
    } catch {}
  }
  return finished;
}
async function startReview(directory, departmentId, options = {}) {
  const info = await (options.inspectFn ?? inspect)(directory, { run: options.run });
  const departments = departmentsFor(info.settings, info.agents);
  const department = departments.find((item) => item.id === departmentId) ?? null;
  if (!department)
    throw new Error("Configure that department before asking the advisor.");
  const advisor = typeof info.settings?.advisor === "string" ? info.settings.advisor.trim() : "";
  if (!advisor)
    throw new Error("Choose an advisor in Settings before asking for a review.");
  if (!primaryAgents(info.agents).some((agent) => agent.id === advisor)) {
    throw new Error(`Advisor "${advisor}" is unavailable. Choose another in Settings.`);
  }
  const finished = await finishedWork(directory, options);
  if (!finished.length)
    throw new Error("No finished Office work to review yet. Finish a task first.");
  const journal = await readDepartmentJournal(directory, department.id);
  const accepted = await dispatch(directory, reviewPrompt(department, journal.lessons, finished), {
    run: options.run,
    agent: advisor,
    department,
    context: false
  });
  await recordReview(directory, department.id, accepted.sessionId);
  return { sessionId: accepted.sessionId, department: department.id, advisor, reviewed: finished.length };
}
async function collectReview(directory, sessionId, options = {}) {
  const found = await findReview(directory, sessionId);
  if (!found)
    throw new Error("That session is not an advisor review for this project.");
  if (found.review.status === "collected")
    throw new Error("Those lessons are already collected.");
  const api = hostApi(options.run);
  const session = await api("GET", `/api/session/${encodeURIComponent(sessionId)}`, {
    "location[directory]": directory
  });
  if (session?.id !== sessionId)
    throw new Error("That advisor session is unavailable.");
  if (!TERMINAL.has(session.outcome))
    throw new Error("The advisor is still working. Collect when it finishes.");
  const rows = messageRows(await api("GET", `/api/session/${encodeURIComponent(sessionId)}/message`, { type: "assistant", limit: 20, order: "desc", "location[directory]": directory }));
  const text = rows.flatMap((row) => Array.isArray(row?.content) ? row.content : []).filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join(`
`);
  const lessons = parseLessons(text);
  if (!lessons.length) {
    const reason = "The advisor wrote no LESSON lines.";
    await updateReview(directory, sessionId, { status: "empty", reason });
    return { added: [], skipped: 0, reason };
  }
  const result = await addLessons(directory, found.department, lessons, sessionId);
  await updateReview(directory, sessionId, {
    status: "collected",
    collectedAt: Date.now(),
    added: result.added.length
  });
  return { added: result.added, skipped: result.skipped };
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
  if (req.method !== "POST" || !["/inspect", "/records", "/settings", "/dispatch", "/usage", "/journal", "/advisor/start", "/advisor/collect"].includes(req.url ?? ""))
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
      return void reply(200, { ...await inspect(data.directory), reservations: await admissionView(data.directory) });
    if (req.url === "/records")
      return void reply(200, { reservations: await admissionView(data.directory) });
    if (req.url === "/settings") {
      if (!["project", "global"].includes(data.scope))
        throw new Error("Unknown settings scope.");
      await saveSettings(data.directory, data.scope, data.values, data.unset);
      return void reply(200, { ok: true });
    }
    if (req.url === "/usage") {
      if (typeof data.rootId !== "string" || !data.rootId || data.rootId.length > 200)
        throw new Error("Select a session to see its usage.");
      const result = await usage(await realpath4(data.directory), data.rootId, { run: runOpenCode });
      return void reply(200, {
        counts: result.counts,
        reported: result.reported,
        estimated: result.estimated,
        observed: result.observed,
        status: result.status
      });
    }
    if (req.url === "/journal") {
      return void reply(200, { departments: await readProjectJournal(await realpath4(data.directory)) });
    }
    if (req.url === "/advisor/start") {
      if (typeof data.departmentId !== "string" || !data.departmentId)
        throw new Error("Select a department.");
      return void reply(200, await startReview(await realpath4(data.directory), data.departmentId, { run: runOpenCode }));
    }
    if (req.url === "/advisor/collect") {
      if (typeof data.sessionId !== "string" || !data.sessionId)
        throw new Error("Select an advisor session.");
      return void reply(200, await collectReview(await realpath4(data.directory), data.sessionId, { run: runOpenCode }));
    }
    if (typeof data.prompt !== "string" || !data.prompt.trim() || data.prompt.length > 32000)
      throw new Error("Choose a message of 1–32,000 characters.");
    const origin = typeof data.origin?.sessionId === "string" && data.origin.sessionId.length < 200 ? {
      sessionId: data.origin.sessionId,
      ...typeof data.origin.messageId === "string" && data.origin.messageId.length < 200 ? { messageId: data.origin.messageId } : {}
    } : undefined;
    return void reply(200, await dispatch(data.directory, data.prompt, {
      run: runOpenCode,
      origin,
      departmentId: typeof data.departmentId === "string" && data.departmentId ? data.departmentId : undefined
    }));
  } catch (error) {
    return void reply(400, { message: officeError(error) });
  }
}).listen(port, "127.0.0.1");
