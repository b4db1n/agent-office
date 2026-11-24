import {
  connectHost,
  type GuestProject,
  type GuestSessionRecord,
  type GuestSessionsSnapshot,
  type HostReadyContext,
  type SessionSnapshot,
} from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
// @ts-ignore - shared/setup.mjs has no type declarations
import { SETUP_PROMPT, selectLead } from '../shared/setup.mjs';
import { issueExample, issuePreview } from '../shared/contribution.mjs';
import { observation, steward } from '../shared/steward.mjs';
// @ts-ignore - shared/departments.mjs has no type declarations
import { departmentsFor, normalizeDepartments, primaryAgents } from '../shared/departments.mjs';
// @ts-ignore - shared/setting-keys.mjs has no type declarations
import { INACTIVE_SETTINGS, SETTINGS_KEYS } from '../shared/setting-keys.mjs';

const host = connectHost();
const rootEl = document.querySelector<HTMLElement>('#root');
if (!rootEl) throw new Error('Office Steward page has no root element.');
const root: HTMLElement = rootEl;

type ModelRef = { id: string; providerID: string; variant?: string };
type InspectAgent = { id: string; mode?: string; hidden?: boolean; model?: ModelRef | null };
type InspectResult = {
  agents: InspectAgent[];
  models: string[];
  settings: Record<string, unknown>;
  sources: Record<string, unknown>;
  project: unknown;
  global: unknown;
  plugin: boolean | null;
  agentDiscovery?: 'ready' | 'empty' | 'unavailable';
  modelDiscovery?: 'ready' | 'empty' | 'unavailable';
  hostModel?: ModelRef | null;
  reservations?: {rootId:string|null;phase:string;estimatedLeadCost:number|null}[];
};

type CostResult = {
  status: 'ok' | 'partial' | 'unsupported' | 'invalid' | 'no-data';
  observed?: {agent:string;model:string;variant:string|null}[];
  counts?: { reported: number; estimated: number; unknown: number };
  reported?: number;
  estimated?: number;
};

type Department = { id: string; name: string; purpose: string; lead: string; members: string[] };
type Lesson = { id?: string; text: string; source?: string | null };
type Review = { sessionId: string; status: string; reason?: string };
type JournalEntry = { lessons: Lesson[]; reviews: Review[] };

type State = {
  ready: HostReadyContext | null;
  surface: 'panel' | 'status';
  view: 'office' | 'settings' | 'contribute' | 'status';
  directory: string | null;
  projectId: string | null;
  rootId: string | null;
  rootTitle: string;
  snapshot: GuestSessionsSnapshot | null;
  snapshotState: 'loading' | 'ready' | 'error';
  snapshotError: string;
  drafts: Map<string, string>;
  talkDraft: string;
  inspect: InspectResult | null;
  inspectState: 'idle' | 'loading' | 'ready' | 'error';
  inspectError: string;
  settingsScope: 'global' | 'project';
  contribText: string;
  cost: CostResult | null;
  costState: 'idle' | 'loading' | 'ready' | 'error';
  costError: string;
  journal: Record<string, JournalEntry>;
  journalState: 'idle' | 'loading' | 'ready' | 'error';
  journalError: string;
};

/** Stored and validated, but no behaviour reads these keys yet. */
const INACTIVE = new Set<string>(INACTIVE_SETTINGS);

const state: State = {
  ready: null,
  surface: 'panel',
  view: 'office',
  directory: null,
  projectId: null,
  rootId: null,
  rootTitle: '',
  snapshot: null,
  snapshotState: 'loading',
  snapshotError: '',
  drafts: new Map(),
  talkDraft: '',
  inspect: null,
  inspectState: 'idle',
  inspectError: '',
  settingsScope: 'project',
  contribText: issueExample,
  cost: null,
  costState: 'idle',
  costError: '',
  journal: {},
  journalState: 'idle',
  journalError: '',
};

let subscriptionProject: string | null = null;
let subscriptionGeneration = 0;
let projectLoadGeneration = 0;
let unsubscribeSessions: (() => void) | null = null;
let rootLoadGeneration = 0;
let heightFrame = 0;
let inspectGeneration = 0;
let costGeneration = 0;
let recordsGeneration = 0;
const settingEdits = new Map<string, string>();
let composingTask = false;
const taskDrafts = new Map<string,string>();
const submitting = new Set<string>();
let departmentEdits: Department[] | null = null;
let structureEdited = false;
let composingDepartment: string | null = null;
const departmentDrafts = new Map<string, string>();
const departmentSubmitting = new Set<string>();
let journalGeneration = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toast(kind: 'info' | 'success' | 'error', message: string): void {
  void host.toast({ kind, message }).catch(() => undefined);
}

function plainError(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    const message = (error as { message?: unknown }).message;
    if (typeof code === 'string') {
      if (code === 'NO_SERVICE') return 'The Office Steward service is off. Allow it in Settings → Extensions.';
      if (code === 'SERVICE_FAILED') return 'The Office Steward service stopped. Try again.';
      if (code === 'NOT_GRANTED') return 'OpenChamber did not grant that permission.';
      if (code === 'HOST_TIMEOUT') return 'OpenChamber did not answer. Try again.';
      if (code === 'UNSUPPORTED') return 'This OpenChamber surface cannot do that.';
    }
    if (typeof message === 'string' && message.trim().length > 0 && message.length < 240) {
      return message.trim();
    }
  }
  return 'That did not work. Try again.';
}

async function callService<T = Record<string, unknown>>(path: string, payload?: unknown): Promise<T> {
  const result = await host.serviceRequest({
    method: payload === undefined ? 'GET' : 'POST',
    path,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(result.body || '{}');
  } catch {
    parsed = {};
  }
  const record = isRecord(parsed) ? parsed : {};
  if (result.status < 200 || result.status >= 300 || record.ok === false) {
    const error = new Error(typeof record.message === 'string' ? record.message : 'The Office Steward service refused that.');
    (error as { code?: string }).code = typeof record.code === 'string' ? record.code : undefined;
    throw error;
  }
  return record as T;
}

function normalizeDir(directory: string): string {
  return directory.replace(/\/+$/, '');
}

function matchProject(projects: GuestProject[], directory: string): string | null {
  const target = normalizeDir(directory);
  const exact = projects.find((project) => normalizeDir(project.directory) === target);
  if (exact) return exact.id;
  const prefixed = projects
    .filter((project) => target.startsWith(`${normalizeDir(project.directory)}/`))
    .sort((left, right) => normalizeDir(right.directory).length - normalizeDir(left.directory).length);
  return prefixed[0]?.id ?? null;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toneFor(session: GuestSessionRecord): string {
  return observation(session).tone;
}

function stateLabel(session: GuestSessionRecord): string {
  return observation(session).label;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function draftKey(): string {
  return JSON.stringify([state.directory, state.rootId]);
}

async function loadDraft(): Promise<void> {
  const scope = draftKey(), generation = rootLoadGeneration;
  state.talkDraft = state.drafts.get(scope) ?? '';
  if (state.drafts.has(scope)) return;
  const key = `draft:talk:${scope}`;
  try {
    const raw = await host.storage.get(key);
    if (typeof raw === 'string' && generation === rootLoadGeneration && scope === draftKey() && !state.drafts.has(scope)) {
      state.talkDraft = raw; render();
    }
  } catch {
    // Drafts are a convenience.
  }
}

async function saveDraft(): Promise<void> {
  const key = `draft:talk:${draftKey()}`;
  const text = state.talkDraft;
  draftWrite = draftWrite.then(() => host.storage.set(key,text)).then(() => {}, () => {});
  await draftWrite;
}
let draftWrite = Promise.resolve();

async function inspect(): Promise<void> {
  if (!state.directory) {
    state.inspect = null;
    state.inspectState = 'idle';
    state.inspectError = 'No project directory selected.';
    render();
    return;
  }
  const generation = ++inspectGeneration;
  state.inspectState = 'loading';
  state.inspectError = '';
  render();
  try {
    const result = await callService<InspectResult>('/inspect', { directory: state.directory });
    if (generation !== inspectGeneration) return;
    state.inspect = result;
    state.inspectState = 'ready';
  } catch (error) {
    if (generation !== inspectGeneration) return;
    state.inspectState = 'error';
    state.inspectError = plainError(error);
  }
  render();
}

function unsetForSave(): string[] {
  const unset: string[] = [];
  for (const key of SETTINGS_KEYS) {
    if (INACTIVE.has(key) || !settingEdits.has(key)) continue;
    const el = document.getElementById(`setting-${key}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!el) continue;
    if (!el.value.trim()) unset.push(key);
  }
  return unset;
}

async function saveSettings(): Promise<void> {
  if (!settingEdits.size && !structureEdited) return;
  if (!state.directory) {
    toast('error', 'Open a project first.');
    return;
  }
  const values: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const key of SETTINGS_KEYS) {
    if (INACTIVE.has(key) || !settingEdits.has(key)) continue;
    const el = document.getElementById(`setting-${key}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!el) continue;
    const raw = el.value;
    if (!raw.trim()) {
      unset.push(key);
      continue;
    }
    if (raw.trim() === 'null') {
      values[key] = null;
      continue;
    }
    if (key === 'notifications') values[key] = raw === 'true';
    else if (key === 'parallelism' || key === 'budget') {
      const num = Number(raw);
      values[key] = Number.isFinite(num) && raw.trim() !== '' ? num : raw;
    } else if (key === 'agentModels' || key === 'visibleControls') {
      const trimmed = raw.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          values[key] = JSON.parse(trimmed);
        } catch {
          values[key] = raw;
        }
      } else {
        values[key] = raw;
      }
    } else {
      values[key] = raw;
    }
  }
  const payload: Record<string, unknown> = { directory: state.directory, scope: state.settingsScope, values };
  const directory = state.directory, scope = state.settingsScope;
  if (structureEdited) {
    try {
      values.departments = normalizeDepartments(structureDepartments()) ?? [];
    } catch (error) {
      toast('error', plainError(error));
      return;
    }
    const advisor = (document.getElementById('office-advisor') as HTMLSelectElement | null)?.value ?? '';
    if (advisor) values.advisor = advisor;
    else unset.push('advisor');
    payload.values = values;
  }
  if (unset.length > 0) payload.unset = unset;
  try {
    await callService('/settings', payload);
    if (directory !== state.directory || scope !== state.settingsScope) return;
    settingEdits.clear();
    structureEdited = false;
    departmentEdits = null;
    toast('success', `Settings saved (${state.settingsScope}).`);
    await inspect();
  } catch (error) {
    toast('error', plainError(error));
  }
}

function setView(view: State['view']): void {
  state.view = view;
  if (view === 'office' && state.rootId && state.costState === 'idle') void loadCost();
  if (view === 'settings' && !state.inspect && state.directory) void inspect();
  render();
}

function scheduleHeight(): void {
  if (heightFrame) cancelAnimationFrame(heightFrame);
  heightFrame = requestAnimationFrame(() => {
    heightFrame = 0;
    const height = Math.ceil(root.getBoundingClientRect().height);
    void host.setHeight(Math.min(480, Math.max(24, height))).catch(() => undefined);
  });
}

async function openSession(id: string): Promise<void> {
  if (!id) return;
  try {
    await host.openSession(id);
  } catch {
    toast('error', 'Open this chat from the sidebar.');
  }
}

function talkToAgent(id: string): void {
  void openSession(id);
}

async function copySetupPrompt(): Promise<void> {
  try {
    await host.writeClipboard(SETUP_PROMPT);
    toast('success', 'Setup prompt copied.');
  } catch {
    toast('error', 'Could not copy. Select and copy manually.');
  }
}

async function copyDraft(): Promise<void> {
  try {
    await host.writeClipboard(state.talkDraft);
    toast('success', 'Draft copied.');
  } catch {
    toast('error', 'Could not copy. Select and copy manually.');
  }
}

function clearDraft(): void {
  state.talkDraft = '';
  state.drafts.set(draftKey(), '');
  void saveDraft();
  render();
}

function openContributeIssue(): void {
  const textarea = document.getElementById('contrib-text') as HTMLTextAreaElement | null;
  const text = textarea ? textarea.value : state.contribText;
  state.contribText = text;
  try {
    void host.openUrl(issuePreview(text)).catch(error => toast('error', plainError(error)));
  } catch (error) { toast('error', plainError(error)); }
}

function cancelContribute(): void {
  state.contribText = issueExample;
  state.view = 'office';
  render();
}

function setRoot(id: string | null, title: string): boolean {
  if (id === state.rootId) {
    state.rootTitle = title;
    return false;
  }
  ++rootLoadGeneration;
  state.rootId = id;
  state.rootTitle = title;
  state.talkDraft = '';
  state.cost = null;
  state.costState = 'idle';
  state.costError = '';
  void loadDraft();
  return true;
}

async function loadCost(): Promise<void> {
  if (state.costState === 'loading' || state.view !== 'office') return;
  if (!state.directory || !state.rootId) {
    state.cost = null;
    state.costState = 'idle';
    state.costError = '';
    render();
    return;
  }
  const directory = state.directory;
  const rootId = state.rootId;
  const generation = ++costGeneration;
  state.costState = 'loading';
  state.costError = '';
  render();
  try {
    const result = await callService<CostResult>('/usage', { directory, rootId });
    if (generation !== costGeneration) return;
    if (state.directory !== directory || state.rootId !== rootId) return;
    state.cost = result;
    state.costState = 'ready';
  } catch (error) {
    if (generation !== costGeneration) return;
    if (state.directory !== directory || state.rootId !== rootId) return;
    state.costState = 'error';
    state.costError = plainError(error);
    state.cost = null;
  }
  render();
}

async function ensureProject(force = false): Promise<void> {
  const directory = state.directory;
  if (!directory) {
    state.projectId = null;
    state.snapshot = null;
    state.snapshotState = 'error';
    state.snapshotError = 'No project folder is open.';
    render();
    return;
  }
  const load = ++projectLoadGeneration;
  try {
    const projects = await host.listProjects();
    if (load !== projectLoadGeneration) return;
    if (projects.state !== 'ready') {
      state.snapshotState = 'loading';
      state.snapshotError = 'OpenChamber is still loading the project list.';
      render();
      return;
    }
    const projectId = matchProject(projects.projects, directory);
    if (!projectId) {
      state.projectId = null;
      state.snapshot = null;
      state.snapshotState = 'error';
      state.snapshotError = 'This folder is not a registered OpenChamber project.';
      render();
      return;
    }
    if (!force && subscriptionProject === projectId && unsubscribeSessions) {
      state.projectId = projectId;
      render();
      void inspect();
      void loadJournal();
      return;
    }
    const generation = ++subscriptionGeneration;
    if (unsubscribeSessions) {
      unsubscribeSessions();
      unsubscribeSessions = null;
    }
    subscriptionProject = projectId;
    state.projectId = projectId;
    state.snapshot = null;
    state.snapshotState = 'loading';
    state.snapshotError = '';
    render();

    const unsubscribe = await host.onSessions(projectId, (snapshot) => {
      if (generation !== subscriptionGeneration) return;
      if (snapshot.kind !== 'sessions' || (snapshot.projectId && snapshot.projectId !== projectId)) return;
      const ids = (s: GuestSessionsSnapshot | null) => s?.sessions.filter(x => x.directory === directory && !x.parentId && !x.archivedAt).map(x => x.id).sort().join(':');
      const rootsChanged = ids(snapshot) !== ids(state.snapshot);
      state.snapshot = snapshot;
      state.snapshotState = snapshot.state === 'ready' ? 'ready' : snapshot.state === 'loading' ? 'loading' : 'error';
      state.snapshotError = snapshot.state === 'error' ? 'OpenChamber could not read the session list.' : '';
      render();
      if (rootsChanged && state.inspect) {
        const token = ++recordsGeneration;
        void callService<Pick<InspectResult,'reservations'>>('/records', { directory }).then(result => {
          if (token === recordsGeneration && generation === subscriptionGeneration && state.inspect) {
            state.inspect.reservations = result.reservations; render();
          }
        }).catch(() => {
          if (token === recordsGeneration && generation === subscriptionGeneration && state.inspect) {
            state.inspect.reservations = undefined; render();
          }
        });
      }
      if (state.rootId && snapshot.state === 'ready' && state.costState === 'idle') void loadCost();
    });
    if (generation !== subscriptionGeneration) {
      unsubscribe();
      return;
    }
    unsubscribeSessions = unsubscribe;
    void inspect();
    void loadJournal();
  } catch {
    if (load !== projectLoadGeneration) return;
    state.snapshotState = 'loading';
    state.snapshotError = 'OpenChamber did not send the session list.';
    render();
  }
}

function currentDepartments(): Department[] {
  return departmentsFor(state.inspect?.settings ?? {}, state.inspect?.agents ?? []) as Department[];
}

function advisorId(): string {
  const value = state.inspect?.settings?.advisor;
  return typeof value === 'string' ? value : '';
}

function journalFor(id: string): JournalEntry {
  const entry = state.journal[id];
  return {
    lessons: Array.isArray(entry?.lessons) ? entry.lessons : [],
    reviews: Array.isArray(entry?.reviews) ? entry.reviews : [],
  };
}

function structureDepartments(): Department[] {
  return (departmentEdits ?? currentDepartments()).map((department) => ({
    ...department,
    members: [...department.members],
  }));
}

async function loadJournal(): Promise<void> {
  const directory = state.directory;
  if (!directory) return;
  const generation = ++journalGeneration;
  state.journalState = 'loading';
  try {
    const result = await callService<{ departments?: Record<string, JournalEntry> }>('/journal', { directory });
    if (generation !== journalGeneration || directory !== state.directory) return;
    state.journal = result.departments ?? {};
    state.journalState = 'ready';
    state.journalError = '';
  } catch (error) {
    if (generation !== journalGeneration || directory !== state.directory) return;
    state.journalState = 'error';
    state.journalError = plainError(error);
  }
  render();
}

function renderStatus(): string {
  const health = steward(state);
  const preview = settingEdits.size > 0;
  return `<section class="ao-shell ao-status">
    <h2 class="ao-title">Office Steward · ${preview ? 'Setup preview pending' : esc(health.state)}</h2>
    <p class="ao-sub" title="${esc(state.directory)}">${esc(state.directory?.split('/').pop() || 'No project')}</p>
    <div>${preview ? 'Review your unsaved changes in Settings.' : esc(health.reason)}</div>
    ${health.configured ? `<div>Lead: <b>${esc(state.inspect?.settings.lead)}</b> · ${esc(health.model ?? 'Unknown model')} (${esc(health.source)})</div>` : ''}
    ${health.state === 'Setup required' ? setupControls() : ''}
    ${health.configured ? `<div><strong>Current work</strong></div>
      ${health.records.length ? health.records.map(r => `<button class="ao-btn" data-record="${esc(r.id)}" data-current="${r.id === state.rootId ? 'true' : 'false'}">${esc(r.agent || r.title)} · ${esc(r.label)}${r.id === state.rootId ? ' · viewing' : ''}</button>`).join('')
      : '<span class="ao-muted">No confirmed Office team visible for this project.</span>'}
      ${state.rootId && health.records.length && !health.records.some(r => r.id === state.rootId) ? `<p class="ao-muted">Viewing ${esc(state.rootTitle || state.rootId)} — not part of this Office team.</p>` : ''}` : ''}
    <div class="ao-row">${health.state === 'Ready' && !preview && !composingTask ? '<button id="ask-office" class="ao-btn primary" data-action="askOffice">Ask Office lead</button>' : ''}<button class="ao-btn" data-view="office">Open Office</button>
    <button class="ao-btn" data-view="settings">Settings</button>
    <button class="ao-btn" data-action="refresh">Refresh</button></div>
    ${composingTask && health.state === 'Ready' && !preview ? `<label for="office-task">New task for ${esc(state.inspect?.settings.lead)}</label>
      <textarea id="office-task" maxlength="32000" class="ao-input">${esc(taskDrafts.get(state.directory!) ?? '')}</textarea>
      <div class="ao-row"><button class="ao-btn primary" data-action="submitTask" ${submitting.has(state.directory!) ? 'disabled' : ''}>Send to lead</button>
      <button class="ao-btn" data-action="cancelTask">Cancel</button></div>` : ''}
    </section>`;
}

function setupControls(): string {
  return `<p>Inspect this project, preview missing definitions, then approve only what you want.</p>
    <button class="ao-btn" data-action="copySetup">Copy setup prompt</button>`;
}

function renderDepartments(): string {
  const departments = currentDepartments();
  if (!departments.length) return '';
  const advisor = advisorId();
  const cards = departments.map((department) => {
    const journal = journalFor(department.id);
    const pending = [...journal.reviews].reverse().find((review) => review.status === 'pending');
    const learned = journal.lessons.slice(-3).reverse();
    const composing = composingDepartment === department.id;
    return `<div class="ao-card" data-department-card="${esc(department.id)}">
      <div class="ao-row" style="justify-content:space-between;">
        <div>
          <h3 class="ao-title" style="font-size:13px;">${esc(department.name)}</h3>
          <div class="ao-muted">${esc(department.purpose || 'No purpose set.')}</div>
        </div>
        <span class="ao-muted">${department.members.length} member${department.members.length === 1 ? '' : 's'}</span>
      </div>
      <div class="ao-muted">Lead: <b>${esc(department.lead)}</b>${department.members.length ? ` · ${department.members.map((m) => esc(m)).join(', ')}` : ''}</div>
      <div class="ao-muted">${journal.lessons.length} lesson${journal.lessons.length === 1 ? '' : 's'}${advisor ? ` · advisor ${esc(advisor)}` : ' · no advisor yet'}</div>
      ${learned.length ? `<div class="ao-muted">What this team learned:</div><ul>${learned.map((lesson) => `<li>${esc(lesson.text)}</li>`).join('')}</ul>` : ''}
      ${pending ? '<div class="ao-muted">An advisor review is open — collect its lessons when the advisor finishes.</div>' : ''}
      <div class="ao-row">
        <button class="ao-btn" data-action="askDepartment" data-dept="${esc(department.id)}">Ask ${esc(department.name)}</button>
        ${advisor ? `<button class="ao-btn" data-action="advisorReview" data-dept="${esc(department.id)}">Advisor review</button>` : ''}
        ${pending ? `<button class="ao-btn primary" data-action="collectReview" data-dept="${esc(department.id)}" data-session="${esc(pending.sessionId)}">Collect lessons</button>` : ''}
      </div>
      ${composing ? `<div class="ao-field"><label for="dept-task-${esc(department.id)}">New task for ${esc(department.name)}</label>
        <textarea id="dept-task-${esc(department.id)}" maxlength="32000" class="ao-input">${esc(departmentDrafts.get(department.id) ?? '')}</textarea></div>
        <div class="ao-row"><button class="ao-btn primary" data-action="sendDepartment" data-dept="${esc(department.id)}" ${departmentSubmitting.has(department.id) ? 'disabled' : ''}>Send to ${esc(department.lead)}</button>
        <button class="ao-btn" data-action="cancelDepartment">Cancel</button></div>` : ''}
    </div>`;
  }).join('');
  return `<div class="ao-card">
    <div class="ao-row" style="justify-content:space-between;"><h3 class="ao-title" style="font-size:13px;">Departments</h3>
      <span class="ao-muted">${state.journalState === 'error' ? esc(state.journalError) : state.journalState === 'loading' ? 'Reading lessons…' : ''}</span></div>
    <div class="ao-grid" style="grid-template-columns:1fr;">${cards}</div>
  </div>`;
}

function renderOffice(): string {
  const sessions = officeSessions();
  const viewingOutside = !!state.rootId && !sessions.some(s => s.id === state.rootId);
  const agentsHtml =
    sessions.length === 0
      ? `<div class="ao-empty">${state.snapshotState === 'ready' ? 'No confirmed Office team visible for this project.' : 'Waiting for project sessions…'}</div>`
      : `<div class="ao-grid">
          ${sessions
            .map(
              (s) => `
            <button id="agent-${esc(s.id)}" class="ao-agent" data-tone="${toneFor(s)}" data-session="${esc(s.id)}" data-current="${s.id === state.rootId ? 'true' : 'false'}"${s.id === state.rootId ? ' title="Viewing this chat"' : ''}>
              <span class="ao-avatar" aria-hidden="true">${esc(initials(s.agent || s.title))}</span>
              <div class="ao-row" style="justify-content:space-between;">
                <span class="ao-agent-name">${esc(s.agent || s.title)}${s.id === state.rootId ? ' (viewing)' : ''}</span>
                <span class="ao-agent-state">${esc(stateLabel(s))}</span>
              </div>
              <div class="ao-agent-detail">${esc(s.title)}</div>
               <div class="ao-agent-detail ao-muted">${esc(s.tool ? [s.tool.name,s.tool.target].filter(Boolean).join(' · ') : '')}</div>
            </button>`,
            )
            .join('')}
        </div>`;
  const talkValue = esc(state.talkDraft);
  const costHtml = state.rootId ? renderCostCard() : '';
  return `
    <div class="ao-shell">
      <div>
        <h2 class="ao-title">Office Steward</h2>
        <p class="ao-sub">${esc(state.rootTitle || state.directory || 'No session')}</p>
      </div>
      ${renderDepartments()}
      ${agentsHtml}
      ${viewingOutside ? `<p class="ao-muted">Viewing ${esc(state.rootTitle || state.rootId)} — this chat is not part of the Office team shown.</p>` : ''}
      <div class="ao-card">
        <div class="ao-field">
          <label for="talk-draft">Talk (opens session, never sends)</label>
          <textarea id="talk-draft" class="ao-textarea" rows="3">${talkValue}</textarea>
        </div>
        <div class="ao-row">
          ${state.rootId ? `<button class="ao-btn primary" data-action="talkOpen">Open selected session</button>` : ''}
          <button class="ao-btn" data-action="copyDraft">Copy draft</button>
          <button class="ao-btn" data-action="talkClear">Clear draft</button>
          <button class="ao-btn" data-action="refresh">Refresh</button>
        </div>
      </div>
      ${costHtml}
    </div>
  `;
}

function renderCostCard(): string {
  const c = state.cost;
  if (state.costState === 'loading') {
    return `<div class="ao-card"><h3 class="ao-title" style="font-size:13px;">Cost</h3><p class="ao-muted">Loading…</p></div>`;
  }
  if (state.costState === 'error') {
    return `<div class="ao-card"><h3 class="ao-title" style="font-size:13px;">Cost</h3><p class="ao-muted">${esc(state.costError)}</p><button class="ao-btn" data-action="refreshCost">Refresh cost</button></div>`;
  }
  if (!c || !['ok','partial','no-data'].includes(c.status)) {
    return `<div class="ao-card"><h3 class="ao-title" style="font-size:13px;">Cost</h3><p class="ao-muted">Usage unavailable.</p><button class="ao-btn" data-action="refreshCost">Refresh cost</button></div>`;
  }
  const counts = c.counts ?? { reported: 0, estimated: 0, unknown: 0 };
  const dollars = (n: number | undefined) => n === undefined || !Number.isFinite(n) ? 'Unknown' :
    n > 0 && n < .000001 ? '&lt;$0.000001' : `$${n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6})}`;
  return `
    <div class="ao-card">
      <h3 class="ao-title" style="font-size:13px;">Cost</h3>
      ${c.status === 'no-data' ? '<div>No usage observed.</div>' : ''}
      ${c.status === 'partial' ? '<div>Partial usage — totals are incomplete.</div>' : ''}
      ${counts.reported ? `<div>Host-reported: ${dollars(c.reported)}</div>` : ''}
      ${counts.estimated ? `<div>Estimated at catalog rates: ${dollars(c.estimated)}</div>` : ''}
      ${counts.unknown ? `<div>Unknown cost: ${Number(counts.unknown)} messages</div>` : ''}
      ${(c.observed ?? []).map(item => `<div>Observed: ${esc(item.agent)} · ${esc(item.model)}${item.variant ? `#${esc(item.variant)}` : ''}</div>`).join('')}
      <button class="ao-btn" data-action="refreshCost">Refresh cost</button>
    </div>
  `;
}

function settingField(key: string, disabled = false): string {
  const insp = state.inspect;
  const layer = insp?.[state.settingsScope];
  const val = settingEdits.get(key) ?? (isRecord(layer) ? layer[key] : undefined);
  const valueStr =
    typeof val === 'string'
      ? val
       : val === null && state.settingsScope === 'project' ? 'null' : val === null || val === undefined
        ? ''
        : JSON.stringify(val, null, 2);
  const isLong = key === 'agentModels' || key === 'visibleControls';
  const choices = key === 'lead' ? selectLead(insp?.agents ?? [], null).available
    : ['leadModel', 'specialistModel'].includes(key) ? insp?.models ?? []
    : key === 'notifications' ? ['true', 'false']
    : key === 'appearance' ? ['system', 'light', 'dark']
    : null;
  const off = disabled ? ' disabled' : '';
  const control = choices
    ? `<select id="setting-${key}" class="ao-input"${off}><option value="">Inherit default</option><option value="null" ${valueStr==='null'?'selected':''}>Host default</option>${[...new Set([...choices,...(valueStr && valueStr!=='null' ? [valueStr] : [])])].map(id => `<option value="${esc(id)}" ${id === valueStr ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select>`
    : isLong
    ? `<textarea id="setting-${key}" class="ao-textarea" placeholder="{}"${off}>${esc(valueStr)}</textarea>`
    : `<input id="setting-${key}" class="ao-input" value="${esc(valueStr)}" placeholder="${key === 'language' ? 'en' : ''}"${off} />`;
  return `<div class="ao-field" data-inactive="${disabled ? 'true' : 'false'}"><label for="setting-${key}">${esc(key)}</label>${control}<small>Effective: ${esc(JSON.stringify(insp?.settings?.[key]) ?? 'Host default')} · ${esc(insp?.sources?.[key] ?? 'host')}</small></div>`;
}

function renderSettings(): string {
  const insp = state.inspect;
  const fields = SETTINGS_KEYS
    .filter((key) => key !== 'departments' && key !== 'advisor' && !INACTIVE.has(key))
    .map((key) => settingField(key))
    .join('');
  const inactiveFields = SETTINGS_KEYS
    .filter((key) => INACTIVE.has(key))
    .map((key) => settingField(key, true))
    .join('');

  const agentsHtml = (insp?.agents ?? [])
    .map((a) => `<tr><td>${esc(a.id)}</td><td>${esc(a.mode ?? '')}</td><td>${a.hidden ? 'yes' : 'no'}</td><td>${esc(a.model ? `${a.model.providerID}/${a.model.id}${a.model.variant ? ` (${a.model.variant})` : ''}` : '')}</td></tr>`)
    .join('');
  const modelsHtml = (insp?.models ?? []).map((m) => `<li>${esc(m)}</li>`).join('');

  const hostModel = insp?.hostModel;
  const hostModelText = hostModel ? `${hostModel.providerID}/${hostModel.id}${hostModel.variant ? ` (${hostModel.variant})` : ''}` : 'Host default';
  const bound = insp?.agents?.find(a => a.id === insp.settings.lead)?.model;
  const effectiveLeadModel = typeof insp?.settings?.leadModel === 'string' ? insp.settings.leadModel : bound ? `${bound.providerID}/${bound.id}${bound.variant ? `#${bound.variant}` : ''}` : hostModelText;
  const leadModelSource = insp?.sources?.leadModel ?? 'host';

  return `
    <div class="ao-shell">
      <div>
        <h2 class="ao-title">Settings</h2>
        <p class="ao-sub">${state.inspectState === 'loading' ? 'Loading…' : state.inspectError ? esc(state.inspectError) : 'Effective configuration'}</p>
      </div>
      <div class="ao-card">
        <p class="ao-muted">Agent discovery: ${esc(insp?.agentDiscovery ?? 'unknown')} · Model discovery: ${esc(insp?.modelDiscovery ?? 'unknown')}</p>
        <details><summary>Revisit setup</summary>${setupControls()}</details>
        <p class="ao-muted">Host default model: ${esc(hostModelText)}</p>
        <p class="ao-muted">Requested lead model: ${esc(effectiveLeadModel)} (${esc(leadModelSource)}). Specialist selection is a preference, not enforced routing.</p>
        <p class="ao-muted">Office admission budget: blank inherits; null means no Office limit. A finite budget, including 0, blocks dispatch when the host cannot bound delegated costs.</p>
        <p class="ao-muted">Recorded reservations (rechecked on admission): ${insp?.reservations?.length ?? 'unknown'}. These are not observed charges.</p>
        <div class="ao-row">
          <span class="ao-muted">Scope:</span>
          <button class="ao-btn ${state.settingsScope === 'global' ? 'primary' : ''}" data-scope="global">Global</button>
          <button class="ao-btn ${state.settingsScope === 'project' ? 'primary' : ''}" data-scope="project">Project</button>
           <button class="ao-btn primary" data-action="saveSettings">Apply changes</button>
          <button class="ao-btn" data-action="refreshInspect">Refresh</button>
        </div>
         <output id="settings-preview">${esc(settingsPreview())}</output>
         <div class="ao-field-grid" style="display:grid;gap:8px;">
          ${fields}
        </div>
      </div>
      <div class="ao-card" data-inactive-settings>
        <h3 class="ao-title" style="font-size:13px;">Stored, not used yet</h3>
        <p class="ao-muted">Nothing reads these settings yet, so changing them would have no effect. They stay visible and disabled so saved values are not lost; each one becomes active when the feature it configures exists.</p>
        <details><summary>Show inactive settings</summary><div class="ao-field-grid" style="display:grid;gap:8px;">${inactiveFields}</div></details>
      </div>
      ${renderStructure()}
      <div class="ao-card">
        <h3 class="ao-title" style="font-size:13px;">Agents</h3>
        <table class="ao-table">
          <thead><tr><th>id</th><th>mode</th><th>hidden</th><th>model</th></tr></thead>
          <tbody>${agentsHtml || '<tr><td colspan="4" class="ao-muted">None</td></tr>'}</tbody>
        </table>
      </div>
      <div class="ao-card">
        <h3 class="ao-title" style="font-size:13px;">Models</h3>
        <ul>${modelsHtml || '<li class="ao-muted">None</li>'}</ul>
        <h3 class="ao-title" style="font-size:13px;margin-top:8px;">Model origin / sources</h3>
        <pre class="ao-pre">${esc(JSON.stringify(state.inspect?.sources ?? {}, null, 2))}</pre>
        <h3 class="ao-title" style="font-size:13px;margin-top:8px;">Project</h3>
        <pre class="ao-pre">${esc(JSON.stringify(state.inspect?.project ?? null, null, 2))}</pre>
        <h3 class="ao-title" style="font-size:13px;margin-top:8px;">Global</h3>
        <pre class="ao-pre">${esc(JSON.stringify(state.inspect?.global ?? null, null, 2))}</pre>
        <p class="ao-muted">Plugin: ${esc(state.inspect?.plugin)}</p>
      </div>
    </div>
  `;
}

function renderContribute(): string {
  return `
    <div class="ao-shell">
      <div>
        <h2 class="ao-title">Contribution preview</h2>
        <p class="ao-sub">Edit the synthetic text. Nothing is sent until you click "Open GitHub issue draft".</p>
      </div>
      <div class="ao-card">
        <textarea id="contrib-text" class="ao-textarea">${esc(state.contribText)}</textarea>
        <div class="ao-row">
          <button class="ao-btn primary" data-action="openIssueDraft">Open GitHub issue draft</button>
          <button class="ao-btn" data-action="cancelContribute">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function renderStructure(): string {
  const agents = primaryAgents(state.inspect?.agents ?? []) as { id: string }[];
  if (!agents.length) return '';
  const departments = structureDepartments();
  const advisor = advisorId();
  const rows = departments.map((department, index) => `
    <fieldset class="ao-card" data-dept-card="${esc(department.id)}">
      <div class="ao-row" style="justify-content:space-between;">
        <b>Department ${index + 1}</b>
        <button class="ao-btn" data-action="removeDepartment" data-dept="${esc(department.id)}">Remove</button>
      </div>
      <div class="ao-field"><label for="dept-${esc(department.id)}-name">Name</label>
        <input id="dept-${esc(department.id)}-name" class="ao-input" data-dept-field="name" data-dept="${esc(department.id)}" value="${esc(department.name)}" maxlength="40" /></div>
      <div class="ao-field"><label for="dept-${esc(department.id)}-purpose">Purpose</label>
        <input id="dept-${esc(department.id)}-purpose" class="ao-input" data-dept-field="purpose" data-dept="${esc(department.id)}" value="${esc(department.purpose)}" maxlength="160" /></div>
      <div class="ao-field"><label for="dept-${esc(department.id)}-lead">Lead</label>
        <select id="dept-${esc(department.id)}-lead" class="ao-input" data-dept-field="lead" data-dept="${esc(department.id)}">
          ${agents.map((agent) => `<option value="${esc(agent.id)}" ${agent.id === department.lead ? 'selected' : ''}>${esc(agent.id)}</option>`).join('')}
        </select></div>
      <div class="ao-field"><span>Members</span>
        <div class="ao-row">${agents.filter((agent) => agent.id !== department.lead).map((agent) =>
          `<label class="ao-muted"><input type="checkbox" data-dept-field="member" data-dept="${esc(department.id)}" value="${esc(agent.id)}" ${department.members.includes(agent.id) ? 'checked' : ''} /> ${esc(agent.id)}</label>`).join('') || '<span class="ao-muted">No other primary agents.</span>'}</div></div>
    </fieldset>`).join('');
  return `<div class="ao-card">
    <h3 class="ao-title" style="font-size:13px;">Office structure</h3>
    <div class="ao-field"><label for="office-advisor">Advisor</label>
      <select id="office-advisor" class="ao-input" data-office-field="advisor">
        <option value="">None</option>
        ${agents.map((agent) => `<option value="${esc(agent.id)}" ${agent.id === advisor ? 'selected' : ''}>${esc(agent.id)}</option>`).join('')}
      </select>
      <small>The advisor reviews finished work and writes lessons for the team. It never edits an agent on its own.</small></div>
    ${rows}
    <div class="ao-row"><button class="ao-btn" data-action="addDepartment">Add department</button></div>
    <p class="ao-muted">Departments organize agents that already exist. Office never creates or spawns one.</p>
  </div>`;
}

function settingsPreview(): string {
  const layer = state.inspect?.[state.settingsScope];
  const parts: string[] = [];
  if (settingEdits.size) {
    parts.push([...settingEdits].map(([key, value]) =>
      `${key}: ${JSON.stringify(isRecord(layer) ? layer[key] ?? null : null)} → ${value || 'inherit'}`).join('; '));
  }
  if (structureEdited) parts.push('Office structure: departments and advisor');
  return parts.length ? 'Setup preview pending · ' + parts.join(' · ') : '';
}

function renderPanel(): string {
  const tabs = (['office', 'settings', 'contribute'] as const)
    .map(
      (v) => `
    <button class="ao-tab" aria-pressed="${state.view === v}" data-view="${v}">${v.charAt(0).toUpperCase() + v.slice(1)}</button>`,
    )
    .join('');
  let body = '';
  if (state.view === 'settings') body = renderSettings();
  else if (state.view === 'contribute') body = renderContribute();
  else body = renderOffice();
  return `
    <div class="ao-shell">
      <div class="ao-tabs">${tabs}</div>
      ${body}
    </div>
  `;
}

function render(): void {
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  let savedFocus: string | null = null;
  let savedSelection: { start: number; end: number; direction: 'forward' | 'backward' | 'none' } | null = null;
  if (active && active.id) {
    savedFocus = active.id;
    if (typeof active.selectionStart === 'number') {
      savedSelection = {
        start: active.selectionStart,
        end: active.selectionEnd ?? active.selectionStart,
        direction: (active.selectionDirection as 'forward' | 'backward' | 'none') ?? 'none',
      };
    }
  }
  if (state.surface === 'status') {
    root.innerHTML = state.view === 'status' ? renderStatus() : `<button data-view="status" class="ao-btn">Back to Work Status</button>` + renderPanel();
  } else {
    root.innerHTML = renderPanel();
  }
  if (savedFocus) {
    const el = document.getElementById(savedFocus) as HTMLElement | null;
    if (el && typeof (el as { focus?: () => void }).focus === 'function') {
      (el as { focus: () => void }).focus();
      if (savedSelection && typeof (el as { setSelectionRange?: (a: number, b: number, c?: string) => void }).setSelectionRange === 'function') {
        try {
          (el as { setSelectionRange: (a: number, b: number, c?: string) => void }).setSelectionRange(
            savedSelection.start,
            savedSelection.end,
            savedSelection.direction,
          );
        } catch {
          // Ignore.
        }
      }
    }
  }
  if (state.surface === 'status') scheduleHeight();
}

const handlers = {
  askOffice: () => { composingTask = true; render(); document.getElementById('office-task')?.focus(); },
  cancelTask: () => { composingTask = false; render(); document.getElementById('ask-office')?.focus(); },
  submitTask: async () => {
    const dir = state.directory, prompt = dir && taskDrafts.get(dir)?.trim();
    if (!dir || !prompt || submitting.has(dir) || steward(state).state !== 'Ready') return;
    submitting.add(dir); render();
    try {
      const accepted = await callService('/dispatch', {directory:dir, prompt});
      if (typeof accepted.sessionId !== 'string' || accepted.directory !== dir) throw new Error('Delivery unconfirmed. Inspect the Office before retrying.');
      taskDrafts.delete(dir);
      if (dir === state.directory) {
        composingTask = false;
        await openSession(accepted.sessionId);
      }
    } catch (e) { toast('error', plainError(e)); }
    finally { submitting.delete(dir); if (dir === state.directory) void inspect(); }
  },
  setView: (v: string) => setView(v as State['view']),
  refresh: () => {
    void ensureProject(true);
  },
  refreshInspect: () => {
    void inspect();
  },
  refreshCost: () => {
    void loadCost();
  },
  openSession: (id: string) => {
    void openSession(id);
  },
  talkInput: (value: string) => {
    state.talkDraft = value;
    state.drafts.set(draftKey(), value);
    void saveDraft();
  },
  talkOpen: () => {
    if (state.rootId) void openSession(state.rootId);
  },
  copyDraft: () => {
    copyDraft();
  },
  talkClear: () => {
    clearDraft();
  },
  copySetup: () => {
    void copySetupPrompt();
  },
  setScope: (scope: string) => {
    settingEdits.clear();
    structureEdited = false;
    departmentEdits = null;
    state.settingsScope = scope === 'project' ? 'project' : 'global';
    render();
  },
  saveSettings: () => {
    void saveSettings();
  },
  openIssueDraft: () => {
    openContributeIssue();
  },
  cancelContribute: () => {
    cancelContribute();
  },
  askDepartment: (arg?: { dept?: string }) => {
    if (!arg?.dept) return;
    composingDepartment = arg.dept;
    render();
    document.getElementById(`dept-task-${arg.dept}`)?.focus();
  },
  cancelDepartment: () => {
    composingDepartment = null;
    render();
  },
  sendDepartment: async (arg?: { dept?: string }) => {
    const id = arg?.dept;
    const dir = state.directory;
    const prompt = dir && id ? departmentDrafts.get(id)?.trim() : '';
    if (!dir || !id || !prompt || departmentSubmitting.has(id)) return;
    departmentSubmitting.add(id);
    render();
    try {
      const accepted = await callService<{ sessionId?: string; directory?: string }>('/dispatch', { directory: dir, prompt, departmentId: id });
      if (typeof accepted.sessionId !== 'string' || accepted.directory !== dir) throw new Error('Delivery unconfirmed. Inspect the Office before retrying.');
      departmentDrafts.delete(id);
      composingDepartment = null;
      await openSession(accepted.sessionId);
    } catch (error) {
      toast('error', plainError(error));
    } finally {
      departmentSubmitting.delete(id);
      if (dir === state.directory) void inspect();
    }
  },
  advisorReview: async (arg?: { dept?: string }) => {
    const id = arg?.dept;
    if (!id || !state.directory) return;
    try {
      const result = await callService<{ sessionId?: string }>('/advisor/start', { directory: state.directory, departmentId: id });
      if (typeof result.sessionId !== 'string') throw new Error('The advisor session was not created.');
      await openSession(result.sessionId);
      void loadJournal();
    } catch (error) {
      toast('error', plainError(error));
    }
  },
  collectReview: async (arg?: { dept?: string; session?: string }) => {
    if (!arg?.session || !state.directory) return;
    try {
      const result = await callService<{ added?: string[]; reason?: string }>('/advisor/collect', {
        directory: state.directory,
        sessionId: arg.session,
      });
      const added = Array.isArray(result.added) ? result.added.length : 0;
      toast(added ? 'success' : 'info', added
        ? `${added} lesson${added === 1 ? '' : 's'} saved for this team.`
        : (result.reason || 'No lessons found.'));
      void loadJournal();
    } catch (error) {
      toast('error', plainError(error));
    }
  },
  addDepartment: () => {
    const list = structureDepartments();
    if (list.length >= 8) {
      toast('error', 'At most 8 departments.');
      return;
    }
    const agents = primaryAgents(state.inspect?.agents ?? []) as { id: string }[];
    const used = new Set(list.map((department) => department.id));
    let number = list.length + 1;
    let id = `department-${number}`;
    while (used.has(id)) id = `department-${++number}`;
    list.push({
      id,
      name: `Department ${list.length + 1}`,
      purpose: '',
      lead: agents[0]?.id ?? '',
      members: [],
    });
    departmentEdits = list;
    structureEdited = true;
    render();
  },
  removeDepartment: (arg?: { dept?: string }) => {
    if (!arg?.dept) return;
    departmentEdits = structureDepartments().filter((department) => department.id !== arg.dept);
    structureEdited = true;
    render();
  },
};

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  state.ready = context;
  const surface = context.surface === 'status' ? 'status' : 'panel';
  if (state.surface !== surface) state.view = surface === 'status' ? 'status' : 'office';
  state.surface = surface;
  const previousDirectory = state.directory;
  changeDirectory(context.directory);
  const rootChanged = setRoot(context.session?.id ?? null, context.session?.title ?? '');
  render();
  if (rootChanged || state.directory !== previousDirectory) void ensureProject();
  if (state.rootId) void loadCost();
});

host.onSession((session: SessionSnapshot | null) => {
  const previousTitle = state.rootTitle;
  const rootChanged = setRoot(session?.id ?? null, session?.title ?? '');
  if (rootChanged || state.rootTitle !== previousTitle) render();
  if (rootChanged) {
    void ensureProject();
    if (state.rootId) void loadCost();
  }
});

host.onDirectory((directory) => {
  if (directory === state.directory) return;
  changeDirectory(directory);
  render();
  void ensureProject();
});

function changeDirectory(directory: string | null) {
  if (directory === state.directory) return;
  subscriptionGeneration++; projectLoadGeneration++; inspectGeneration++; rootLoadGeneration++; costGeneration++;
  unsubscribeSessions?.(); unsubscribeSessions = null; subscriptionProject = null;
  state.directory = directory; state.snapshot = null; state.projectId = null;
  composingTask = false;
  settingEdits.clear();
  state.settingsScope = 'project';
  state.inspect = null; state.inspectState = 'idle'; state.snapshotState = 'loading';
  state.rootId = null; state.talkDraft = ''; state.rootTitle = '';
  state.cost = null; state.costState = 'idle'; state.costError = '';
  journalGeneration++;
  state.journal = {}; state.journalState = 'idle'; state.journalError = '';
  departmentEdits = null; structureEdited = false;
  composingDepartment = null; departmentDrafts.clear(); departmentSubmitting.clear();
}

function officeSessions(): GuestSessionRecord[] {
  // One projection feeds both surfaces: Work Status records and this grid
  // always carry the same confirmed Office family ids.
  return steward(state).family as GuestSessionRecord[];
}
root.addEventListener('input', e => {
  const field = e.target as HTMLInputElement;
  if (field.id === 'office-task' && state.directory) taskDrafts.set(state.directory,field.value);
  if (field.id?.startsWith('dept-task-') && composingDepartment) departmentDrafts.set(composingDepartment, field.value);
  if (field.id?.startsWith('setting-')) {
    settingEdits.set(field.id.slice(8), field.value);
    const preview = document.getElementById('settings-preview');
    if (preview) preview.textContent = settingsPreview();
  }
  if (field.dataset.officeField === 'advisor') {
    structureEdited = true;
    const preview = document.getElementById('settings-preview');
    if (preview) preview.textContent = settingsPreview();
  }
  if (field.dataset.deptField && field.dataset.dept) {
    structureEdited = true;
    const list = (departmentEdits ??= structureDepartments());
    const department = list.find((item) => item.id === field.dataset.dept);
    if (department) {
      const kind = field.dataset.deptField;
      if (kind === 'member') {
        department.members = field.checked
          ? [...new Set([...department.members, field.value])]
          : department.members.filter((member) => member !== field.value);
      } else if (kind === 'lead') {
        department.lead = field.value;
        department.members = department.members.filter((member) => member !== field.value);
      } else if (kind === 'name' || kind === 'purpose') {
        department[kind] = field.value;
      }
      const preview = document.getElementById('settings-preview');
      if (preview) preview.textContent = settingsPreview();
    }
  }
  if (e.target instanceof HTMLTextAreaElement && e.target.id === 'talk-draft') handlers.talkInput(e.target.value);
  if (e.target instanceof HTMLTextAreaElement && e.target.id === 'contrib-text') state.contribText = e.target.value;
});
root.addEventListener('click', e => {
  const view = (e.target as Element).closest<HTMLElement>('[data-view]')?.dataset.view;
  if (view === 'office' || view === 'settings' || view === 'status' || view === 'contribute') setView(view);
  const button = (e.target as Element).closest<HTMLElement>('[data-action],[data-scope]');
  if (button?.dataset.scope) handlers.setScope(button.dataset.scope);
  const key = button?.dataset.action;
  if (key && ['askOffice','submitTask','cancelTask','copySetup','refresh','refreshInspect','refreshCost','saveSettings','openIssueDraft','cancelContribute','talkOpen','copyDraft','talkClear','askDepartment','cancelDepartment','sendDepartment','advisorReview','collectReview','addDepartment','removeDepartment'].includes(key)) {
    (handlers[key as keyof typeof handlers] as (arg?: { dept?: string; session?: string }) => void)({
      dept: button?.dataset.dept,
      session: button?.dataset.session,
    });
  }
  const id = (e.target as Element).closest<HTMLElement>('[data-session]')?.dataset.session;
  if (id && officeSessions().some(s => s.id === id)) void openSession(id);
  const record = (e.target as Element).closest<HTMLElement>('[data-record]')?.dataset.record;
  if (record && steward(state).records.some(s => s.id === record)) void openSession(record);
});
root.addEventListener('keydown', e => {
  if (e.key === 'Escape' && composingTask) handlers.cancelTask();
});
render();
