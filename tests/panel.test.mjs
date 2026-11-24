// Behavioural browser regression tests for panel/main.ts.
// Run with: node --test tests/panel.test.mjs
// Alternative: bun test tests/panel.test.mjs
// Optional browser checks. Install Playwright separately, or set
// PLAYWRIGHT_MODULE to its module path. Without it these tests skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { issueExample } from '../shared/contribution.mjs';

// Resolve an already-installed Playwright: an explicit module path, a local
// copy, or the conventional global npm roots. No installs or subprocesses.
function moduleUrl(specifier) {
  return path.isAbsolute(specifier) || specifier.startsWith('.')
    ? pathToFileURL(specifier).href
    : specifier;
}
const globalRoots = [
  path.join(os.homedir(), '.npm-global', 'lib', 'node_modules'),
  path.join(os.homedir(), '.npm', 'lib', 'node_modules'),
  '/usr/local/lib/node_modules',
  '/usr/lib/node_modules',
];
const playwrightCandidates = [
  process.env.PLAYWRIGHT_MODULE,
  'playwright',
  ...globalRoots.map(root => path.join(root, 'playwright', 'index.mjs')),
  ...globalRoots.map(root => path.join(root, 'playwright')),
];
let chromium = null;
for (const candidate of playwrightCandidates.filter(Boolean)) {
  try {
    const loaded = await import(moduleUrl(candidate));
    if (loaded?.chromium) { chromium = loaded.chromium; break; }
  } catch {}
}
// A usable browser needs both the module and its downloaded Chromium binary.
let browserAvailable = false;
if (chromium) {
  try {
    browserAvailable = fs.existsSync(chromium.executablePath());
  } catch {}
}
const browserSkipReason = 'Chromium is not installed. Run: bun run test:panel';
if (!browserAvailable && process.env.PANEL_REQUIRE_BROWSER === '1') {
  throw new Error('PANEL_REQUIRE_BROWSER=1 but Chromium is not installed. Run: bun run test:panel');
}
const browserTest = (name, fn) => test(name, { skip: browserAvailable ? false : browserSkipReason }, fn);
const PANEL_URL = pathToFileURL(fileURLToPath(new URL('../panel/index.html', import.meta.url))).href + '?v=' + Date.now();
const DIR_A = '/tmp/project-a';
const DIR_B = '/tmp/project-b';
const PROJECTS = [
  { id: 'p-a', directory: DIR_A, title: 'Project A' },
  { id: 'p-b', directory: DIR_B, title: 'Project B' },
];

// A genuinely configured, discovery-complete project. The default inspect
// fixture below intentionally omits these fields; use this one for dashboard
// (Work Status) regressions that depend on the steward lifecycle.
const READY_INSPECT = {
  agents: [
    { id: 'lead', mode: 'primary', model: { providerID: 'opencode-go', id: 'beam-free' } },
    { id: 'helper', mode: 'primary' },
  ],
  models: ['opencode-go/beam-free', 'opencode-go/glm-5-free'],
  variants: {},
  settings: { lead: 'lead', leadModel: 'opencode-go/beam-free', specialistModel: 'opencode-go/glm-5-free' },
  sources: { lead: 'project', leadModel: 'project', specialistModel: 'project' },
  project: { lead: 'lead' }, global: { lead: null }, plugin: true,
  agentDiscovery: 'ready', modelDiscovery: 'ready',
  hostModel: { providerID: 'opencode-go', id: 'beam-free' },
  reservations: [{ rootId: 'root-1', phase: 'finished', estimatedLeadCost: null }],
};
const READY_COVERAGE = [{ directory: DIR_A, state: 'ready' }];

function session(id, parentId, opts = {}) {
  return {
    id,
    parentId: parentId ?? null,
    projectId: opts.projectId ?? 'p-a',
    title: opts.title ?? id,
    agent: opts.agent ?? id,
    activity: opts.activity ?? 'idle',
    outcome: opts.outcome ?? null,
    unread: opts.unread === true,
    archivedAt: opts.archivedAt ?? null,
    directory: opts.directory ?? (opts.projectId === 'p-b' ? DIR_B : DIR_A),
  };
}

function hostScript(opts = {}) {
  const readySession = opts.readySession ?? { id: 'root-1', title: 'Root One', busy: false };
  const directory = opts.directory ?? DIR_A;
  const sessionsByProject = opts.sessionsByProject ?? { 'p-a': opts.sessions ?? [] };
  const delay = Number(opts.delaySnapshotMs ?? 0);
  const surface = opts.surface ?? 'panel';
  const inspect = opts.inspect ?? {
    agents: [{ id: 'lead', mode: 'primary' }, { id: 'helper', mode: 'primary' }],
    models: ['opencode-go/beam-free', 'opencode-go/glm-5-free'],
    settings: { lead: 'lead', leadModel: 'opencode-go/beam-free', specialistModel: 'opencode-go/glm-5-free' },
    sources: { lead: 'project', leadModel: 'project', specialistModel: 'project' },
    project: { lead: 'lead' }, global: { lead: null }, plugin: true,
    reservations: ['root-1', 'root-2', 'root-a', 'root-b'].map(rootId => ({ rootId, phase: 'finished', estimatedLeadCost: null })),
  };
  return `
    const frame = document.getElementById('frame');
    const win = () => frame.contentWindow;
    const store = new Map();
    window.__sessionsByProject = ${JSON.stringify(sessionsByProject)};
    window.__projects = ${JSON.stringify(PROJECTS)};
    window.__readySession = ${JSON.stringify(readySession)};
    window.__directory = ${JSON.stringify(directory)};
    window.__opened = [];
    window.__forbidden = [];
    window.__subs = [];
    window.__storage = store;
    window.__delay = ${delay};
    window.__inspect = ${JSON.stringify(inspect)};
    window.__coverage = ${JSON.stringify(opts.coverage ?? [
      { directory: DIR_A, state: 'ready' },
      { directory: DIR_B, state: 'ready' },
    ])};
    window.__dispatchReplies = ${JSON.stringify(opts.dispatchReplies ?? [])};
    window.__holdDispatch = ${opts.holdDispatch === true};
    window.__heldDispatch = [];
    window.__failPaths = ${JSON.stringify(opts.failPaths ?? [])};
    window.__serviceReplies = ${JSON.stringify(opts.serviceReplies ?? {})};
    window.__serviceRequests = [];
    window.__urls = [];
    window.__clipboard = [];

    function reply(m, payload) {
      const msg = { channel: 'openchamber.sdk', v: 1, type: 'result', id: m.id, ok: true };
      if (payload !== undefined) msg.payload = payload;
      setTimeout(() => win().postMessage(msg, '*'), 5);
    }
    window.__releaseDispatch = () => {
      const held = window.__heldDispatch.splice(0);
      for (const item of held) reply(item.m, { status: 200, body: JSON.stringify(item.accepted) });
      return held.length;
    };
    function snapshotFor(projectId) {
      return { kind: 'sessions', state: 'ready', projectId, coverage: window.__coverage, sessions: (window.__sessionsByProject[projectId] || []) };
    }
    window.__push = (subId, snap) => {
      win().postMessage({ channel: 'openchamber.sdk', v: 1, type: 'workspace', payload: { subscriptionId: subId, snapshot: snap } }, '*');
    };
    window.__pushCurrent = () => {
      const sub = window.__subs.filter(s => s.kind === 'sessions').pop();
      if (sub) window.__push(sub.id, snapshotFor(sub.projectId));
    };
    window.__setSessions = (projectId, list) => { window.__sessionsByProject[projectId] = list; };

    window.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.channel !== 'openchamber.sdk') return;
      if (m.type === 'hello') {
        setTimeout(() => win().postMessage({
          channel: 'openchamber.sdk', v: 1, type: 'ready',
          payload: {
            theme: { mode: 'dark', tokens: {} }, locale: 'en',
            directory: window.__directory, session: window.__readySession,
            surface: ${JSON.stringify(surface)}, connection: { connected: true, account: null },
            settings: {}, item: null,
          }
        }, '*'), 5);
        return;
      }
      if (m.type === 'workspace-read') {
        const q = m.payload || {};
        const snapshot = q.kind === 'projects'
          ? { kind: 'projects', state: 'ready', projects: window.__projects }
          : snapshotFor(q.projectId);
        setTimeout(() => reply(m, snapshot), window.__delay);
        return;
      }
      if (m.type === 'workspace-subscribe') {
        const subId = m.payload.subscriptionId;
        const q = m.payload.query;
        if (q.kind === 'sessions') window.__subs.push({ id: subId, projectId: q.projectId, kind: q.kind });
        setTimeout(() => {
          reply(m, undefined);
          setTimeout(() => {
            const snapshot = q.kind === 'projects'
              ? { kind: 'projects', state: 'ready', projects: window.__projects }
              : snapshotFor(q.projectId);
            window.__push(subId, snapshot);
          }, 10);
        }, 5);
        return;
      }
      if (m.type === 'workspace-unsubscribe') {
        const subId = m.payload && m.payload.subscriptionId;
        window.__subs = window.__subs.filter(s => s.id !== subId);
        reply(m, undefined);
        return;
      }
      if (m.type === 'storage') {
        const p = m.payload || {};
        if (p.op === 'get') reply(m, { op: 'get', storage: store.get(p.key) });
        else if (p.op === 'set') { store.set(p.key, p.value); reply(m, { op: 'set', storage: p.value }); }
        else if (p.op === 'delete') { store.delete(p.key); reply(m, { op: 'delete' }); }
        else reply(m, { op: p.op, storage: undefined });
        return;
      }
      if (m.type === 'open-session') {
        window.__opened.push(m.payload.sessionId);
        reply(m, undefined);
        return;
      }
      if (['prompt', 'compose', 'start-session'].includes(m.type)) {
        window.__forbidden.push(m.type);
        reply(m, { ok: true });
        return;
      }
      if (m.type === 'service-request') {
        const p = m.payload || {};
        let body = {};
        try { body = p.body ? JSON.parse(p.body) : {}; } catch { body = {}; }
        window.__serviceRequests.push({ method: p.method, path: p.path, body });
        if (window.__failPaths.includes(p.path)) {
          reply(m, { status: 503, body: JSON.stringify({ ok: false, code: 'SERVICE_FAILED', message: 'Injected service failure.' }) });
          return;
        }
        if (Object.prototype.hasOwnProperty.call(window.__serviceReplies, p.path)) {
          reply(m, { status: 200, body: JSON.stringify(window.__serviceReplies[p.path]) });
          return;
        }
        if (p.path === '/dispatch') {
          const accepted = window.__dispatchReplies.shift() ?? { sessionId: 'dispatched-1', directory: window.__directory };
          if (window.__holdDispatch) { window.__heldDispatch.push({ m, accepted }); return; }
          reply(m, { status: 200, body: JSON.stringify(accepted) });
          return;
        }
        reply(m, { status: 200, body: JSON.stringify(window.__inspect) });
        return;
      }
      if (m.type === 'open-url') {
        window.__urls.push(m.payload.url);
        reply(m, undefined);
        return;
      }
      if (m.type === 'clipboard-write') {
        window.__clipboard.push(m.payload);
        reply(m, undefined);
        return;
      }
      if (m.id !== undefined) reply(m, undefined);
    });
  `;
}

async function start(opts = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  if (opts.viewport) await page.setViewportSize(opts.viewport);
  const html = `<!doctype html><html><body style="margin:0">
    <iframe id="frame" src="${PANEL_URL}" style="width:100%;height:100vh;border:0"></iframe>
    <script>${hostScript(opts)}</script>
  </body></html>`;
  const file = path.join(os.tmpdir(), `office-panel-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(file, html);
  await page.goto('file://' + file);
  const frame = page.frame({ url: /panel\/index\.html/ });
  const readySelector = opts.surface === 'status' ? '.ao-status' : '#talk-draft';
  await frame.locator(readySelector).waitFor({ timeout: 5000 });
  return { browser, page, frame };
}

async function cards(frame) {
  return frame.locator('.ao-agent').evaluateAll(els => els.map(el => ({ id: el.id, text: el.innerText })));
}
async function visibleIds(frame) {
  return (await cards(frame)).map(c => c.id.replace(/^agent-/, ''));
}
async function subTitle(frame) {
  return frame.locator('.ao-sub').first().innerText();
}
async function sendSession(page, id, title) {
  await page.evaluate(({ id, title }) => {
    document.querySelector('iframe').contentWindow.postMessage({
      channel: 'openchamber.sdk', v: 1, type: 'session',
      payload: { session: { id, title, busy: false } },
    }, '*');
  }, { id, title });
}
async function sendDirectory(page, directory) {
  await page.evaluate((directory) => {
    document.querySelector('iframe').contentWindow.postMessage({
      channel: 'openchamber.sdk', v: 1, type: 'directory', payload: { directory },
    }, '*');
  }, directory);
}

browserTest('selected root shows its own team with truthful activity labels', async () => {
  const sessions = [
    session('root-1', null, { title: 'Root task', outcome: 'completed' }),
    session('child', 'root-1', { title: 'Child task' }),
    session('grandchild', 'child', { title: 'Grandchild task', unread: true }),
    session('root-2', null, { title: 'Other root', activity: 'completed' }),
    session('child-2', 'root-2', { title: 'Other child' }),
  ];
  const { browser, frame } = await start({ sessions, readySession: { id: 'root-1', title: 'Root One', busy: false } });

  try {
  // #talk-draft renders before inspect/snapshot hydrate the confirmed family.
  await frame.locator('#agent-root-1').waitFor({ timeout: 5000 });
  assert.equal(await subTitle(frame), 'Root One');
  assert.deepEqual((await visibleIds(frame)).sort(), ['child', 'grandchild', 'root-1']);
  const rootCard = await cards(frame).then(all => all.find(c => c.id === 'agent-root-1'));
  assert.match(rootCard.text, /Completed · result not verified/);
  assert.doesNotMatch(rootCard.text, /Reply ready/);
  const grandCard = await cards(frame).then(all => all.find(c => c.id === 'agent-grandchild'));
  assert.match(grandCard.text, /Idle · unread activity/);
  assert.doesNotMatch(grandCard.text, /Reply ready/);
  } finally { await browser.close(); }
});

browserTest('same-project root switch hydrates delayed snapshot without stale callbacks', async () => {
  const sessions = [
    session('root-1', null, { activity: 'completed' }),
    session('child', 'root-1', { title: 'Child Root' }),
    session('grandchild', 'child'),
    session('other', null),
  ];
  const { browser, page, frame } = await start({ sessions, delaySnapshotMs: 400 });

  try {
  await sendSession(page, 'child', 'Child Root');
  await frame.locator('#agent-child').waitFor({ timeout: 5000 });
  assert.equal(await subTitle(frame), 'Child Root');
  // A descendant sees its whole confirmed Office family, not just its subtree.
  assert.deepEqual((await visibleIds(frame)).sort(), ['child', 'grandchild', 'root-1']);
  // A stale workspace push for an old/unknown subscription must not repaint the team.
  // Push a stale workspace snapshot with an unknown subscription id.
  await page.evaluate(() => {
    window.__push('stale-subscription', {
      kind: 'sessions', state: 'ready',
      sessions: [
        { id: 'root-1', parentId: null, projectId: 'p-a', title: 'stale root', agent: 'root-1', activity: 'completed', unread: false, archivedAt: null },
        { id: 'child', parentId: 'root-1', projectId: 'p-a', title: 'stale child', agent: 'child', activity: 'idle', unread: false, archivedAt: null },
      ],
    });
  });
  await page.waitForTimeout(100);
  assert.deepEqual((await visibleIds(frame)).sort(), ['child', 'grandchild', 'root-1']);
  assert.equal(await subTitle(frame), 'Child Root');
  } finally { await browser.close(); }
});

browserTest('switching project B removes project A team', async () => {
  const sessionsByProject = {
    'p-a': [session('root-a', null, { activity: 'completed' }), session('child-a', 'root-a')],
    'p-b': [session('root-b', null, { projectId: 'p-b', activity: 'completed' }), session('child-b', 'root-b', { projectId: 'p-b' })],
  };
  const { browser, page, frame } = await start({ sessionsByProject, readySession: { id: 'root-a', title: 'Root A', busy: false } });

  try {
  await frame.locator('#agent-root-a').waitFor({ timeout: 5000 });
  assert.deepEqual((await visibleIds(frame)).sort(), ['child-a', 'root-a']);
  await sendDirectory(page, DIR_B);
  await sendSession(page, 'root-b', 'Root B');
  await frame.locator('#agent-root-b').waitFor({ timeout: 5000 });
  const ids = await visibleIds(frame);
  assert.ok(ids.includes('root-b') && ids.includes('child-b'));
  assert.ok(!ids.includes('root-a') && !ids.includes('child-a'));
  assert.equal(await subTitle(frame), 'Root B');
  } finally { await browser.close(); }
});

browserTest('only descendants of the selected root appear', async () => {
  const sessions = [
    session('root-1', null),
    session('c1', 'root-1'),
    session('g1', 'c1'),
    session('root-2', null),
    session('c2', 'root-2'),
    session('foreign', 'root-1', { projectId: 'p-b' }),
    session('archived', 'root-1', { archivedAt: '2026-01-01' }),
  ];
  const { browser, frame } = await start({ sessions });

  try {
  await frame.locator('#agent-root-1').waitFor({ timeout: 5000 });
  assert.deepEqual((await visibleIds(frame)).sort(), ['c1', 'g1', 'root-1']);
  } finally { await browser.close(); }
});

browserTest('Talk opens the exact root and never sends a message', async () => {
  const sessions = [session('root-1', null, { activity: 'waiting-question' }), session('child', 'root-1')];
  const { browser, page, frame } = await start({ sessions });

  try {
  await frame.locator('[data-action="talkOpen"]').waitFor({ timeout: 5000 });
  await frame.locator('[data-action="talkOpen"]').click();
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => window.__opened), ['root-1']);
  assert.deepEqual(await page.evaluate(() => window.__forbidden), []);
  } finally { await browser.close(); }
});

browserTest('activity labels are truthful: Idle, Completed, unread (no inferred reply)', async () => {
  const sessions = [
    session('root-1', null, { activity: 'idle', outcome: null, unread: false }),
    session('done', 'root-1', { activity: 'idle', outcome: 'completed', unread: false }),
    session('unread', 'done', { activity: 'idle', outcome: null, unread: true }),
  ];
  const { browser, frame } = await start({ sessions });

  try {
  await frame.locator('#agent-unread').waitFor({ timeout: 5000 });
  const byId = new Map((await cards(frame)).map(c => [c.id, c.text]));
  assert.match(byId.get('agent-root-1'), /Idle/);
  assert.match(byId.get('agent-done'), /Completed · result not verified/);
  assert.match(byId.get('agent-unread'), /Idle · unread activity/);
  for (const text of byId.values()) assert.doesNotMatch(text, /Reply ready/);
  } finally { await browser.close(); }
});

browserTest('focus and DOM stay stable; drafts are per root and persist', async () => {
  const sessions = [session('root-1', null, { activity: 'completed' }), session('child', 'root-1')];
  const { browser, page, frame } = await start({ sessions });

  try {
  await frame.locator('#agent-root-1').waitFor({ timeout: 5000 });
  const area = frame.locator('#talk-draft');
  await area.fill('draft for root one');
  await page.waitForTimeout(100);
  const keyOne = JSON.stringify(['/tmp/project-a', 'root-1']);
  assert.equal(await page.evaluate(k => window.__storage.get('draft:talk:' + k), keyOne), 'draft for root one');
  // A live snapshot re-render must not steal focus or replace the draft.
  await page.evaluate(() => window.__pushCurrent());
  await page.waitForTimeout(150);
  assert.equal(await frame.evaluate(() => document.activeElement && document.activeElement.id), 'talk-draft');
  assert.equal(await area.inputValue(), 'draft for root one');
  assert.equal(await frame.locator('#agent-root-1').count(), 1);
  // Switching root swaps the draft; switching back restores it.
  await sendSession(page, 'child', 'Child');
  await frame.locator('#agent-child').waitFor({ timeout: 5000 });
  await page.waitForTimeout(100);
  assert.equal(await area.inputValue(), '');
  await area.fill('draft for child');
  await page.waitForTimeout(100);
  const keyChild = JSON.stringify(['/tmp/project-a', 'child']);
  assert.equal(await page.evaluate(k => window.__storage.get('draft:talk:' + k), keyChild), 'draft for child');
  await sendSession(page, 'root-1', 'Root One');
  await frame.locator('#agent-root-1').waitFor({ timeout: 5000 });
  await page.waitForTimeout(150);
  assert.equal(await area.inputValue(), 'draft for root one');
  assert.equal(await page.evaluate(k => window.__storage.get('draft:talk:' + k), keyOne), 'draft for root one');
  } finally { await browser.close(); }
});

browserTest('configured Work Status is a compact dashboard with an actionable entry point', async () => {
  const sessions = [
    session('root-1', null, { title: 'Root One', outcome: 'completed' }),
    session('child', 'root-1', { title: 'Child', activity: 'running' }),
  ];
  const { browser, frame } = await start({ surface: 'status', sessions, inspect: READY_INSPECT, coverage: READY_COVERAGE });
  try {
    const status = frame.locator('.ao-status');
    await frame.getByText('Agent Office · Ready').waitFor({ timeout: 5000 });
    const text = await status.innerText();
    assert.match(text, /Agent Office · Ready/);
    assert.match(text, /Lead: lead/);
    assert.match(text, /opencode-go\/beam-free \(project\)/);
    assert.match(text, /Office Steward/);
    assert.match(text, /root-1 · Completed · result not verified/);
    assert.match(text, /child · Running/);
    assert.doesNotMatch(text, /Setup required/);
    assert.doesNotMatch(text, /Copy setup prompt/);
    assert.equal(await frame.locator('button[data-action="askOffice"]').count(), 1);
    assert.equal(await frame.locator('button[data-view="office"]').count(), 1);
    assert.equal(await frame.locator('button[data-view="settings"]').count(), 1);
    assert.equal(await frame.locator('button[data-action="refresh"]').count(), 1);
    // The primary action opens a composer; Escape keeps the user on the dashboard.
    await frame.locator('[data-action="askOffice"]').click();
    await frame.locator('#office-task').waitFor({ timeout: 5000 });
    assert.equal(await frame.locator('button[data-action="askOffice"]').count(), 0);
    await frame.locator('#office-task').press('Escape');
    await frame.locator('button[data-action="askOffice"]').waitFor({ timeout: 5000 });
  } finally { await browser.close(); }
});

browserTest('Work Status shows onboarding, not a configured dashboard, when setup is required', async () => {
  const inspect = { ...READY_INSPECT, settings: {}, sources: {}, reservations: [] };
  const { browser, frame } = await start({ surface: 'status', inspect, coverage: READY_COVERAGE, sessions: [session('root-1', null)] });
  try {
    const status = frame.locator('.ao-status');
    await frame.getByText('Agent Office · Setup required').waitFor({ timeout: 5000 });
    const text = await status.innerText();
    assert.match(text, /Agent Office · Setup required/);
    assert.match(text, /Preview the available agents and choose a lead\./);
    assert.match(text, /Copy setup prompt/);
    assert.doesNotMatch(text, /Lead: lead/);
    assert.doesNotMatch(text, /Office Steward/);
    assert.equal(await frame.locator('button[data-action="copySetup"]').count(), 1);
    assert.equal(await frame.locator('button[data-action="askOffice"]').count(), 0);
  } finally { await browser.close(); }
});

browserTest('Work Status names degraded and attention states with recovery controls', async () => {
  const sessions = [session('root-1', null), session('child', 'root-1')];
  const degraded = await start({ surface: 'status', sessions, inspect: READY_INSPECT, coverage: [] });
  try {
    await degraded.frame.getByText('Agent Office · Degraded').waitFor({ timeout: 5000 });
    const text = await degraded.frame.locator('.ao-status').innerText();
    assert.match(text, /Agent Office · Degraded/);
    assert.match(text, /Live session coverage is unavailable/);
    assert.equal(await degraded.frame.locator('button[data-action="refresh"]').count(), 1);
    assert.equal(await degraded.frame.locator('button[data-view="settings"]').count(), 1);
  } finally { await degraded.browser.close(); }

  const waiting = [session('root-1', null, { activity: 'waiting-question' }), session('child', 'root-1')];
  const attention = await start({ surface: 'status', sessions: waiting, inspect: READY_INSPECT, coverage: READY_COVERAGE });
  try {
    await attention.frame.getByText('Agent Office · Needs attention').waitFor({ timeout: 5000 });
    const text = await attention.frame.locator('.ao-status').innerText();
    assert.match(text, /Agent Office · Needs attention/);
    assert.match(text, /Open the highlighted session to inspect its status\./);
    assert.match(text, /root-1 · Waiting for an answer/);
  } finally { await attention.browser.close(); }
});

browserTest('unsaved settings show a preview instead of a dispatch entry point', async () => {
  const { browser, frame } = await start({ surface: 'status', sessions: [session('root-1', null)], inspect: READY_INSPECT, coverage: READY_COVERAGE });
  try {
    await frame.locator('button[data-view="settings"]').click();
    await frame.locator('#setting-language').waitFor({ timeout: 5000 });
    await frame.locator('#setting-language').fill('tr');
    await frame.getByText('Back to Work Status').click();
    await frame.getByText('Setup preview pending').waitFor({ timeout: 5000 });
    const text = await frame.locator('.ao-status').innerText();
    assert.match(text, /Setup preview pending/);
    assert.match(text, /Review your unsaved changes in Settings\./);
    assert.equal(await frame.locator('button[data-action="askOffice"]').count(), 0);
  } finally { await browser.close(); }
});

browserTest('descendant chat: Work Status and Open Office show the same Office family ids', async () => {
  const sessions = [
    session('root-1', null, { title: 'Root', outcome: 'completed' }),
    session('child', 'root-1', { title: 'Child' }),
    session('grandchild', 'child', { title: 'Grandchild', activity: 'running' }),
    session('outside', null, { title: 'Unrelated chat' }),
    session('outside-child', 'outside', { title: 'Unrelated child' }),
  ];
  const { browser, frame } = await start({
    surface: 'status', sessions,
    readySession: { id: 'child', title: 'Child', busy: false },
    inspect: READY_INSPECT, coverage: READY_COVERAGE,
  });
  try {
    await frame.getByText('Agent Office · Ready').waitFor({ timeout: 5000 });
    const statusIds = await frame.locator('[data-record]').evaluateAll(els => els.map(e => e.dataset.record).sort());
    assert.deepEqual(statusIds, ['child', 'grandchild', 'root-1']);
    assert.deepEqual(await frame.locator('[data-record][data-current="true"]').evaluateAll(els => els.map(e => e.dataset.record)), ['child']);

    await frame.locator('button[data-view="office"]').click();
    await frame.locator('.ao-agent').first().waitFor({ timeout: 5000 });
    const panelIds = await frame.locator('[data-session]').evaluateAll(els => els.map(e => e.dataset.session).sort());
    assert.deepEqual(panelIds, statusIds);
    assert.deepEqual(await frame.locator('.ao-agent[data-current="true"]').evaluateAll(els => els.map(e => e.dataset.session)), ['child']);
  } finally { await browser.close(); }
});

browserTest('unrelated chat: both views exclude its subtree and show only confirmed Office work', async () => {
  const sessions = [
    session('root-1', null, { title: 'Root' }),
    session('child', 'root-1', { title: 'Child' }),
    session('outside', null, { title: 'Unrelated chat' }),
    session('outside-child', 'outside', { title: 'Unrelated child' }),
  ];
  const { browser, frame } = await start({
    surface: 'status', sessions,
    readySession: { id: 'outside', title: 'Unrelated chat', busy: false },
    inspect: READY_INSPECT, coverage: READY_COVERAGE,
  });
  try {
    await frame.getByText('Agent Office · Ready').waitFor({ timeout: 5000 });
    const statusIds = await frame.locator('[data-record]').evaluateAll(els => els.map(e => e.dataset.record).sort());
    assert.deepEqual(statusIds, ['child', 'root-1']);
    assert.equal(await frame.locator('[data-current="true"]').count(), 0);

    await frame.locator('button[data-view="office"]').click();
    await frame.locator('.ao-agent').first().waitFor({ timeout: 5000 });
    const panelIds = await frame.locator('[data-session]').evaluateAll(els => els.map(e => e.dataset.session).sort());
    assert.deepEqual(panelIds, statusIds);
    assert.equal(await frame.locator('.ao-agent[data-current="true"]').count(), 0);
  } finally { await browser.close(); }
});

browserTest('missing project id or unready coverage blocks Ready and leaks no records', async () => {
  const sessions = [session('root-1', null), session('child', 'root-1')];
  const { browser, page, frame } = await start({
    surface: 'status', sessions, inspect: READY_INSPECT, coverage: READY_COVERAGE,
  });
  try {
    await frame.getByText('Agent Office · Ready').waitFor({ timeout: 5000 });
    const subId = await page.evaluate(() => window.__subs.find(s => s.kind === 'sessions')?.id);
    const push = (snap) => page.evaluate(({ subId, snap }) => window.__push(subId, snap), { subId, snap });

    // No projectId at all: degrade, do not fall back to the project's teams.
    await push({ kind: 'sessions', state: 'ready', sessions });
    await frame.getByText('Agent Office · Degraded').waitFor({ timeout: 5000 });
    assert.equal(await frame.locator('[data-record]').count(), 0);

    // Recovery restores exactly the confirmed family; nothing stale leaks.
    await push({ kind: 'sessions', state: 'ready', projectId: 'p-a', coverage: READY_COVERAGE, sessions });
    await frame.getByText('Agent Office · Ready').waitFor({ timeout: 5000 });
    assert.deepEqual(await frame.locator('[data-record]').evaluateAll(els => els.map(e => e.dataset.record).sort()), ['child', 'root-1']);

    // Coverage that exists but is not ready must also block Ready and records.
    await push({ kind: 'sessions', state: 'ready', projectId: 'p-a', coverage: [{ directory: DIR_A, state: 'loading' }], sessions });
    await frame.waitForFunction(() => document.querySelector('.ao-status')?.innerText.includes('Live session coverage is unavailable'));
    assert.equal(await frame.locator('[data-record]').count(), 0);
    await frame.locator('button[data-view="office"]').click();
    assert.equal(await frame.locator('.ao-agent').count(), 0);
  } finally { await browser.close(); }
});

browserTest('dashboard fits 390x844 and 1280x800 without horizontal overflow', async () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const { browser, frame } = await start({
      surface: 'status', viewport,
      sessions: [session('root-1', null), session('child', 'root-1')],
      inspect: READY_INSPECT, coverage: READY_COVERAGE,
    });
    try {
      await frame.getByText('Agent Office · Ready').waitFor({ timeout: 5000 });
      const noOverflow = () => frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      assert.equal(await noOverflow(), true, `status overflow at ${viewport.width}`);
      assert.equal(await frame.locator('button[data-view="office"]').isVisible(), true);
      await frame.locator('button[data-view="office"]').click();
      await frame.locator('.ao-agent').first().waitFor({ timeout: 5000 });
      assert.equal(await noOverflow(), true, `office overflow at ${viewport.width}`);
      assert.equal(await frame.locator('#talk-draft').isVisible(), true);
    } finally { await browser.close(); }
  }
});

browserTest('held dispatch: duplicate attempts send once, navigate once, and Escape restores focus', async () => {
  const { browser, page, frame } = await start({
    surface: 'status', sessions: [session('root-1', null, { outcome: 'completed' })],
    inspect: READY_INSPECT, coverage: READY_COVERAGE,
    holdDispatch: true,
    dispatchReplies: [{ sessionId: 'dispatched-1', directory: DIR_A }],
  });
  try {
    await frame.getByText('Agent Office · Ready').waitFor({ timeout: 5000 });
    await frame.locator('[data-action="askOffice"]').click();
    await frame.locator('#office-task').waitFor({ timeout: 5000 });
    assert.equal(await frame.evaluate(() => document.activeElement?.id), 'office-task');
    await frame.locator('#office-task').fill('A small agreed task.');

    await frame.locator('[data-action="submitTask"]').click();
    // The synthetic reply is held: the first request is provably in flight.
    await page.waitForFunction(() => window.__heldDispatch.length === 1);
    assert.equal(await frame.locator('[data-action="submitTask"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__serviceRequests.filter(r => r.path === '/dispatch').length), 1);
    assert.equal(await page.evaluate(() => window.__opened.length), 0);

    // A second attempt reaches the real delegated handler while the first is held.
    const reached = await frame.evaluate(() => {
      const button = document.querySelector('[data-action="submitTask"]');
      if (!button) throw new Error('Submit button disappeared while held.');
      let reachedRoot = false;
      document.getElementById('root').addEventListener('click', () => { reachedRoot = true; }, { once: true, capture: true });
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return reachedRoot;
    });
    assert.equal(reached, true, 'second attempt must reach the real click handler');
    assert.equal(await page.evaluate(() => window.__serviceRequests.filter(r => r.path === '/dispatch').length), 1);
    assert.equal(await page.evaluate(() => window.__heldDispatch.length), 1);
    assert.equal(await page.evaluate(() => window.__opened.length), 0);

    // Release the one held reply: exactly one navigation follows.
    assert.equal(await page.evaluate(() => window.__releaseDispatch()), 1);
    await page.waitForFunction(() => window.__opened.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__opened), ['dispatched-1']);
    assert.equal(await page.evaluate(() => window.__serviceRequests.filter(r => r.path === '/dispatch').length), 1);

    await frame.locator('[data-action="askOffice"]').click();
    await frame.locator('#office-task').press('Escape');
    await frame.locator('[data-action="askOffice"]').waitFor({ timeout: 5000 });
    assert.equal(await frame.evaluate(() => document.activeElement?.dataset?.action), 'askOffice');
  } finally { await browser.close(); }
});

browserTest('refresh failure degrades honestly and recovers when the service answers', async () => {
  const { browser, page, frame } = await start({
    surface: 'status', sessions: [session('root-1', null)],
    inspect: READY_INSPECT, coverage: READY_COVERAGE,
    failPaths: ['/inspect'],
  });
  try {
    await frame.getByText('Agent Office · Degraded').waitFor({ timeout: 5000 });
    assert.match(await frame.locator('.ao-status').innerText(), /The Agent Office service stopped\. Try again\./);
    await page.evaluate(() => { window.__failPaths.length = 0; });
    await frame.locator('button[data-action="refresh"]').click();
    await frame.getByText('Agent Office · Ready').waitFor({ timeout: 5000 });
    assert.equal(await frame.locator('[data-record]').count(), 1);
  } finally { await browser.close(); }
});

browserTest('Settings shows effective config and saves project lead', async () => {
  const { browser, page, frame } = await start({ sessions: [session('root-1', null)] });
  try {
    await frame.locator('.ao-tabs [data-view="settings"]').click();
    await frame.locator('#setting-lead option[value="helper"]').waitFor({ state: 'attached', timeout: 5000 });
    await frame.waitForFunction(() => [...document.querySelectorAll('div.ao-field')]
      .some(el => el.textContent.includes('leadModel') && el.textContent.includes('opencode-go/beam-free')));
    const leadModelHint = await frame.locator('div.ao-field').filter({ hasText: 'leadModel' }).locator('small').innerText();
    assert.match(leadModelHint, /Effective: "opencode-go\/beam-free" · project/);
    const sources = await frame.locator('.ao-pre').first().innerText();
    assert.match(sources, /"lead": "project"/);
    assert.equal(await frame.locator('#setting-lead').inputValue(), 'lead');
    await frame.locator('#setting-lead').selectOption('helper');
    await frame.locator('[data-action="saveSettings"]').click();
    await page.waitForFunction(() => window.__serviceRequests.some(r => r.path === '/settings'));
    const requests = await page.evaluate(() => window.__serviceRequests);
    const save = requests.filter(r => r.path === '/settings').pop();
    assert.equal(save.method, 'POST');
    assert.equal(save.body.directory, DIR_A);
    assert.equal(save.body.scope, 'project');
    assert.equal(save.body.values.lead, 'helper');
  } finally { await browser.close(); }
});

browserTest('Contribute cancel emits no URL and restores the synthetic example', async () => {
  const { browser, page, frame } = await start({ sessions: [session('root-1', null)] });
  try {
    await frame.locator('.ao-tabs [data-view="contribute"]').click();
    assert.equal(await frame.locator('#contrib-text').inputValue(), issueExample);
    const edited = 'Synthetic contribution body for the regression test.';
    await frame.locator('#contrib-text').fill(edited);
    await frame.locator('[data-action="cancelContribute"]').click();
    assert.deepEqual(await page.evaluate(() => window.__urls), []);
    await frame.locator('.ao-tabs [data-view="contribute"]').click();
    assert.equal(await frame.locator('#contrib-text').inputValue(), issueExample);
    await frame.locator('#contrib-text').fill(edited);
    await frame.locator('[data-action="openIssueDraft"]').click();
    await page.waitForFunction(() => window.__urls.length === 1);
    const target = new URL((await page.evaluate(() => window.__urls))[0]);
    assert.equal(target.pathname, '/b4db1n/agent-office/issues/new');
    assert.equal(target.searchParams.get('body'), edited);
  } finally { await browser.close(); }
});

browserTest('status and panel keep only the views that apply', async () => {
  const status = await start({ surface: 'status', sessions: [session('root-1', null)], inspect: READY_INSPECT, coverage: READY_COVERAGE });
  try {
    await status.frame.locator('.ao-status').waitFor({ timeout: 5000 });
    assert.equal(await status.frame.locator('.ao-tabs').count(), 0);
    assert.equal(await status.frame.locator('#talk-draft').count(), 0);
    await status.frame.locator('button[data-view="settings"]').click();
    await status.frame.locator('#setting-lead').waitFor({ timeout: 5000 });
    assert.equal(await status.frame.locator('.ao-status').count(), 0);
    assert.equal(await status.frame.getByText('Back to Work Status').count(), 1);
    await status.frame.getByText('Back to Work Status').click();
    assert.equal(await status.frame.locator('.ao-status').count(), 1);
  } finally { await status.browser.close(); }

  const panel = await start({ sessions: [session('root-1', null)] });
  try {
    await panel.frame.locator('#talk-draft').waitFor({ timeout: 5000 });
    assert.equal(await panel.frame.locator('.ao-status').count(), 0);
    assert.equal(await panel.frame.getByText('Back to Work Status').count(), 0);
    assert.equal(await panel.frame.locator('.ao-tabs').count(), 1);
  } finally { await panel.browser.close(); }
});

const DEPARTMENT_INSPECT = {
  ...READY_INSPECT,
  settings: {
    ...READY_INSPECT.settings,
    advisor: 'helper',
    departments: [{ id: 'engineering', name: 'Engineering', purpose: 'Ship the product', lead: 'lead', members: ['helper'] }],
  },
  sources: { ...READY_INSPECT.sources, advisor: 'project', departments: 'project' },
};

browserTest('departments show their team, lessons and advisor', async () => {
  const { browser, frame } = await start({
    sessions: [session('root-1', null, { title: 'Root task' })],
    readySession: { id: 'root-1', title: 'Root One', busy: false },
    inspect: DEPARTMENT_INSPECT,
    serviceReplies: {
      '/journal': { departments: { engineering: { lessons: [{ id: 'l1', text: 'Run the suite before shipping.' }], reviews: [] } } },
    },
  });
  try {
    const card = frame.locator('[data-department-card="engineering"]');
    await card.waitFor({ timeout: 5000 });
    const text = await card.innerText();
    assert.match(text, /Engineering/);
    assert.match(text, /Ship the product/);
    assert.match(text, /Run the suite before shipping\./);
    assert.match(text, /advisor helper/);
    assert.equal(await card.locator('[data-action="advisorReview"]').count(), 1);
  } finally { await browser.close(); }
});

browserTest('a department task dispatches with its department id', async () => {
  const { browser, frame, page } = await start({
    sessions: [session('root-1', null, { title: 'Root task' })],
    readySession: { id: 'root-1', title: 'Root One', busy: false },
    inspect: DEPARTMENT_INSPECT,
    serviceReplies: { '/journal': { departments: {} } },
  });
  try {
    await frame.locator('[data-action="askDepartment"][data-dept="engineering"]').click();
    await frame.locator('#dept-task-engineering').fill('Fix the login.');
    await frame.locator('[data-action="sendDepartment"][data-dept="engineering"]').click();
    await page.waitForFunction(() => window.__serviceRequests.some((request) => request.path === '/dispatch'));
    const sent = await page.evaluate(() => window.__serviceRequests.find((request) => request.path === '/dispatch'));
    assert.equal(sent.body.departmentId, 'engineering');
    assert.equal(sent.body.prompt, 'Fix the login.');
    await page.waitForFunction(() => window.__opened.includes('dispatched-1'));
  } finally { await browser.close(); }
});

browserTest('settings can add a department and save the structure', async () => {
  const { browser, frame, page } = await start({
    sessions: [session('root-1', null, { title: 'Root task' })],
    readySession: { id: 'root-1', title: 'Root One', busy: false },
    inspect: DEPARTMENT_INSPECT,
    serviceReplies: { '/journal': { departments: {} } },
  });
  try {
    await frame.locator('[data-view="settings"]').click();
    await frame.locator('#office-advisor').waitFor({ timeout: 5000 });
    assert.equal(await frame.locator('#office-advisor').inputValue(), 'helper');
    await frame.locator('[data-action="addDepartment"]').click();
    await frame.locator('#dept-department-2-name').fill('Research');
    await frame.locator('#dept-department-2-purpose').fill('Find the truth');
    await frame.locator('[data-action="saveSettings"]').click();
    await page.waitForFunction(() => window.__serviceRequests.some((request) => request.path === '/settings'));
    const body = await page.evaluate(() => window.__serviceRequests.find((request) => request.path === '/settings').body);
    assert.deepEqual(body.values.departments.map((department) => department.name), ['Engineering', 'Research']);
    assert.equal(body.values.advisor, 'helper');
    assert.equal(body.values.departments[1].purpose, 'Find the truth');
  } finally { await browser.close(); }
});

browserTest('an advisor review opens the session it starts', async () => {
  const { browser, frame, page } = await start({
    sessions: [session('root-1', null, { title: 'Root task' })],
    readySession: { id: 'root-1', title: 'Root One', busy: false },
    inspect: DEPARTMENT_INSPECT,
    serviceReplies: {
      '/journal': { departments: {} },
      '/advisor/start': { sessionId: 'advisor-1', department: 'engineering', advisor: 'helper' },
    },
  });
  try {
    await frame.locator('[data-action="advisorReview"][data-dept="engineering"]').click();
    await page.waitForFunction(() => window.__serviceRequests.some((request) => request.path === '/advisor/start'));
    const sent = await page.evaluate(() => window.__serviceRequests.find((request) => request.path === '/advisor/start'));
    assert.equal(sent.body.departmentId, 'engineering');
    await page.waitForFunction(() => window.__opened.includes('advisor-1'));
  } finally { await browser.close(); }
});
