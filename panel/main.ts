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
import { officeTeam } from '../shared/office.mjs';

const host = connectHost();
const rootEl = document.querySelector<HTMLElement>('#root');
if (!rootEl) throw new Error('Agent Office page has no root element.');
const root: HTMLElement = rootEl;

type InspectAgent = { id: string; mode?: string; hidden?: boolean };
type InspectResult = {
  agents: InspectAgent[];
  models: string[];
  settings: Record<string, unknown>;
  sources: Record<string, unknown>;
  project: unknown;
  global: unknown;
  plugin: boolean | null;
};

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
};

const SETTINGS_KEYS = [
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
] as const;

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
};

let subscriptionProject: string | null = null;
let subscriptionGeneration = 0;
let projectLoadGeneration = 0;
let unsubscribeSessions: (() => void) | null = null;
let rootLoadGeneration = 0;
let heightFrame = 0;
let inspectGeneration = 0;
const settingEdits = new Map<string,string>();

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
      if (code === 'NO_SERVICE') return 'The Agent Office service is off. Allow it in Settings → Extensions.';
      if (code === 'SERVICE_FAILED') return 'The Agent Office service stopped. Try again.';
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
    const error = new Error(typeof record.message === 'string' ? record.message : 'The Agent Office service refused that.');
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
  if (session.activity === 'waiting-permission' || session.activity === 'waiting-question') return 'waiting';
  if (session.activity === 'running' || session.activity === 'retrying') return 'running';
  if (session.outcome === 'failed') return 'failed';
  return session.unread || session.outcome === 'completed' ? 'ready' : 'idle';
}

function stateLabel(session: GuestSessionRecord): string {
  if (session.activity === 'waiting-permission') return 'Waiting (permission)';
  if (session.activity === 'waiting-question') return 'Waiting (question)';
  if (session.activity === 'running') return 'Running';
  if (session.activity === 'retrying') return 'Retrying';
  if (session.outcome === 'failed') return 'Failed';
  if (session.unread || session.outcome === 'completed') return 'Reply ready';
  return session.activity === 'unknown' ? 'Status unknown' : 'Idle';
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function draftKey(): string {
  return JSON.stringify([state.directory,state.rootId]);
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
  try {
    await host.storage.set(key, state.talkDraft);
  } catch {
    // Drafts are best effort.
  }
}

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

async function saveSettings(): Promise<void> {
  if (!state.directory) {
    toast('error', 'Open a project first.');
    return;
  }
  const values: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) {
    if (!settingEdits.has(key)) continue;
    const el = document.getElementById(`setting-${key}`) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) continue;
    const raw = el.value;
    if (!raw.trim()) values[key] = null;
    else if (key === 'notifications') values[key] = raw === 'true';
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
  try {
    await callService('/settings', { directory: state.directory, scope: state.settingsScope, values });
    settingEdits.clear();
    toast('success', `Settings saved (${state.settingsScope}).`);
    await inspect();
  } catch (error) {
    toast('error', plainError(error));
  }
}

function setView(view: State['view']): void {
  state.view = view;
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
  state.talkDraft = state.talkDraft; // keep
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
  void loadDraft();
  return true;
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
      if (snapshot.kind !== 'sessions') return;
      state.snapshot = snapshot;
      state.snapshotState = snapshot.state === 'ready' ? 'ready' : snapshot.state === 'loading' ? 'loading' : 'error';
      state.snapshotError = snapshot.state === 'error' ? 'OpenChamber could not read the session list.' : '';
      render();
    });
    if (generation !== subscriptionGeneration) {
      unsubscribe();
      return;
    }
    unsubscribeSessions = unsubscribe;
    void inspect();
  } catch {
    if (load !== projectLoadGeneration) return;
    state.snapshotState = 'loading';
    state.snapshotError = 'OpenChamber did not send the session list.';
    render();
  }
}

function renderStatus(): string {
  const lead = selectLead(state.inspect?.agents ?? [],state.inspect?.settings.lead);
  const team = officeSessions();
  const checks = [
    ['Project', !!state.directory, state.directory ? 'Current project selected.' : 'Open a project to scope the Office.'],
    ['Session access', state.snapshotState === 'ready', state.snapshotState === 'ready' ? 'Live updates connected.' : 'Approve session access to see the team.'],
    ['Local service', state.inspectState === 'ready', state.inspectState === 'ready' ? 'OpenCode answered.' : 'Allow the service and opencode executable in Extensions.'],
    ['Lead', !!lead.selected, lead.selected || `Choose ${lead.available.join(' or ') || 'a starter lead'} in Settings to receive work.`],
    ['Models', !!state.inspect?.models.length, `${state.inspect?.models.length ?? 0} available. Choose the lead and specialist models in Settings.`],
    ['Chat command', state.inspect?.plugin === true, state.inspect?.plugin ? '/office is available.' : 'Use Ask Office lead, or preview the companion plugin for /office.'],
  ];
  return `
    <div class="ao-shell">
      <h2 class="ao-title">Agent Office</h2>
      <p class="ao-sub">${esc(state.directory ?? 'No project directory')}</p>
      <div class="ao-card">
        <div class="ao-checklist">
          ${checks
            .map(
               ([label, ok, hint]) => `
            <div class="ao-check ${ok ? 'ok' : ''}">
              <span class="dot"></span>
               <span>${esc(label)}: ${esc(hint)}</span>
            </div>`,
            )
            .join('')}
        </div>
         <div class="ao-row">
           <button class="ao-btn" data-view="settings">Settings</button>
           <button class="ao-btn" data-view="office">Open Office</button>
          <button class="ao-btn primary" data-action="copySetup">Copy setup prompt</button>
          <button class="ao-btn" data-action="refresh">Refresh</button>
        </div>
        <div>${team.filter(s => toneFor(s) === 'waiting' || toneFor(s) === 'ready').map(s => `<button class="ao-btn" data-session="${esc(s.id)}">${esc(s.agent || s.title)} · ${esc(stateLabel(s))}</button>`).join('')}</div>
        <details><summary>Read setup prompt</summary><pre class="ao-pre">${esc(SETUP_PROMPT)}</pre></details>
      </div>
    </div>
  `;
}

function renderOffice(): string {
  const sessions = officeSessions();
  const agentsHtml =
    sessions.length === 0
      ? `<div class="ao-empty">${state.snapshotState === 'ready' ? 'No team visible under this chat.' : 'Waiting for project sessions…'}</div>`
      : `<div class="ao-grid">
          ${sessions
            .map(
              (s) => `
            <button id="agent-${esc(s.id)}" class="ao-agent" data-tone="${toneFor(s)}" data-session="${esc(s.id)}">
              <span class="ao-avatar" aria-hidden="true">${esc(initials(s.agent || s.title))}</span>
              <div class="ao-row" style="justify-content:space-between;">
                <span class="ao-agent-name">${esc(s.agent || s.title)}</span>
                <span class="ao-agent-state">${esc(stateLabel(s))}</span>
              </div>
              <div class="ao-agent-detail">${esc(s.title)}</div>
               <div class="ao-agent-detail ao-muted">${esc(s.tool ? [s.tool.name,s.tool.target].filter(Boolean).join(' · ') : '')}</div>
            </button>`,
            )
            .join('')}
        </div>`;
  const talkValue = esc(state.talkDraft);
  return `
    <div class="ao-shell">
      <div>
        <h2 class="ao-title">Agent Office</h2>
        <p class="ao-sub">${esc(state.rootTitle || state.directory || 'No session')}</p>
      </div>
      ${agentsHtml}
      <div class="ao-card">
        <div class="ao-field">
          <label for="talk-draft">Talk (opens session, never sends)</label>
          <textarea id="talk-draft" class="ao-textarea" rows="3">${talkValue}</textarea>
        </div>
        <div class="ao-row">
          ${state.rootId ? `<button class="ao-btn primary" data-action="talkOpen">Open selected session</button>` : ''}
          <button class="ao-btn" data-action="refresh">Refresh</button>
        </div>
      </div>
    </div>
  `;
}

function renderSettings(): string {
  const insp = state.inspect;
  const fields = SETTINGS_KEYS.map((key) => {
    const layer = insp?.[state.settingsScope];
    const val = settingEdits.get(key) ?? (isRecord(layer) ? layer[key] : undefined);
    const valueStr =
      typeof val === 'string'
        ? val
        : val === null || val === undefined
          ? ''
          : JSON.stringify(val, null, 2);
    const isLong = key === 'agentModels' || key === 'visibleControls';
    const choices = key === 'lead' ? selectLead(insp?.agents ?? [],null).available
      : ['leadModel','specialistModel'].includes(key) ? insp?.models ?? []
      : key === 'notifications' ? ['true','false'] : null;
    const control = choices
      ? `<select id="setting-${key}" class="ao-input"><option value="">Inherit default</option>${choices.map((id:string) => `<option value="${esc(id)}" ${id === valueStr ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select>`
      : isLong
      ? `<textarea id="setting-${key}" class="ao-textarea">${esc(valueStr)}</textarea>`
      : `<input id="setting-${key}" class="ao-input" value="${esc(valueStr)}" />`;
    return `<div class="ao-field"><label for="setting-${key}">${esc(key)}</label>${control}<small>Effective: ${esc(JSON.stringify(insp?.settings[key]) ?? 'Host default')} · ${esc(insp?.sources[key] ?? 'host')}</small></div>`;
  }).join('');

  const agentsHtml = (insp?.agents ?? [])
    .map((a) => `<tr><td>${esc(a.id)}</td><td>${esc(a.mode ?? '')}</td><td>${a.hidden ? 'yes' : 'no'}</td></tr>`)
    .join('');
  const modelsHtml = (insp?.models ?? []).map((m) => `<li>${esc(m)}</li>`).join('');

  return `
    <div class="ao-shell">
      <div>
        <h2 class="ao-title">Settings</h2>
        <p class="ao-sub">${state.inspectState === 'loading' ? 'Loading…' : state.inspectError ? esc(state.inspectError) : 'Effective configuration'}</p>
      </div>
      <div class="ao-card">
        <div class="ao-row">
          <span class="ao-muted">Scope:</span>
          <button class="ao-btn ${state.settingsScope === 'global' ? 'primary' : ''}" data-scope="global">Global</button>
          <button class="ao-btn ${state.settingsScope === 'project' ? 'primary' : ''}" data-scope="project">Project</button>
          <button class="ao-btn primary" data-action="saveSettings">Save</button>
          <button class="ao-btn" data-action="refreshInspect">Refresh</button>
        </div>
        <div class="ao-field-grid" style="display:grid;gap:8px;">
          ${fields}
        </div>
      </div>
      <div class="ao-card">
        <h3 class="ao-title" style="font-size:13px;">Agents</h3>
        <table class="ao-table">
          <thead><tr><th>id</th><th>mode</th><th>hidden</th></tr></thead>
          <tbody>${agentsHtml || '<tr><td colspan="3" class="ao-muted">None</td></tr>'}</tbody>
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

let lastFocusId: string | null = null;

function render(): void {
  lastFocusId = document.activeElement && document.activeElement.id ? document.activeElement.id : null;
  if (state.surface === 'status') {
    root.innerHTML = state.view === 'status' ? renderStatus() : `<button data-view="status" class="ao-btn">Back to Work Status</button>` + renderPanel();
  } else {
    root.innerHTML = renderPanel();
  }
  if (lastFocusId) {
    const el = document.getElementById(lastFocusId);
    if (el && typeof (el as HTMLElement).focus === 'function') (el as HTMLElement).focus();
  }
  if (state.surface === 'status') scheduleHeight();
}

// Expose handlers
const handlers = {
  setView: (v: string) => setView(v as State['view']),
  refresh: () => {
    void ensureProject(true);
  },
  refreshInspect: () => {
    void inspect();
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
  copySetup: () => {
    void copySetupPrompt();
  },
  setScope: (scope: string) => {
    settingEdits.clear();
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
  if (state.surface === 'status') void inspect();
});

host.onSession((session: SessionSnapshot | null) => {
  const previousTitle = state.rootTitle;
  const rootChanged = setRoot(session?.id ?? null, session?.title ?? '');
  if (rootChanged || state.rootTitle !== previousTitle) render();
  if (rootChanged) void ensureProject();
});

host.onDirectory((directory) => {
  if (directory === state.directory) return;
  changeDirectory(directory);
  render();
  void ensureProject();
  void inspect();
});

function changeDirectory(directory: string | null) {
  if (directory === state.directory) return;
  subscriptionGeneration++; projectLoadGeneration++; inspectGeneration++; rootLoadGeneration++;
  unsubscribeSessions?.(); unsubscribeSessions = null; subscriptionProject = null;
  state.directory = directory; state.snapshot = null; state.projectId = null;
  settingEdits.clear();
  state.inspect = null; state.inspectState = 'idle'; state.snapshotState = 'loading';
  state.rootId = null; state.talkDraft = ''; state.rootTitle = '';
}
function officeSessions(): GuestSessionRecord[] {
  return officeTeam(state.snapshot,state.projectId,state.rootId);
}
root.addEventListener('input', e => {
  const field = e.target as HTMLInputElement;
  if (field.id?.startsWith('setting-')) settingEdits.set(field.id.slice(8),field.value);
  if (e.target instanceof HTMLTextAreaElement && e.target.id === 'talk-draft') handlers.talkInput(e.target.value);
  if (e.target instanceof HTMLTextAreaElement && e.target.id === 'contrib-text') state.contribText = e.target.value;
});
root.addEventListener('click', e => {
  const view = (e.target as Element).closest<HTMLElement>('[data-view]')?.dataset.view;
  if (view === 'office' || view === 'settings' || view === 'status' || view === 'contribute') setView(view);
  const button = (e.target as Element).closest<HTMLElement>('[data-action],[data-scope]');
  if (button?.dataset.scope) handlers.setScope(button.dataset.scope);
  const key = button?.dataset.action;
  if (key && ['copySetup','refresh','refreshInspect','saveSettings','openIssueDraft','cancelContribute','talkOpen'].includes(key)) (handlers[key as keyof typeof handlers] as () => void)();
  const id = (e.target as Element).closest<HTMLElement>('[data-session]')?.dataset.session;
  if (id && officeSessions().some(s => s.id === id)) void openSession(id);
});
render();
