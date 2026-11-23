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

let chromium = null;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean)) {
  try {
    ({ chromium } = await import(candidate));
    break;
  } catch {}
}
const browserTest = (name, fn) => test(name, { skip: chromium ? false : 'Playwright is not installed.' }, fn);
const PANEL_URL = pathToFileURL(fileURLToPath(new URL('../panel/index.html', import.meta.url))).href + '?v=' + Date.now();
const DIR_A = '/tmp/project-a';
const DIR_B = '/tmp/project-b';
const PROJECTS = [
  { id: 'p-a', directory: DIR_A, title: 'Project A' },
  { id: 'p-b', directory: DIR_B, title: 'Project B' },
];

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
    window.__serviceRequests = [];
    window.__urls = [];
    window.__clipboard = [];

    function reply(m, payload) {
      const msg = { channel: 'openchamber.sdk', v: 1, type: 'result', id: m.id, ok: true };
      if (payload !== undefined) msg.payload = payload;
      setTimeout(() => win().postMessage(msg, '*'), 5);
    }
    function snapshotFor(projectId) {
      return { kind: 'sessions', state: 'ready', sessions: (window.__sessionsByProject[projectId] || []) };
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
  const html = `<!doctype html><html><body>
    <iframe id="frame" src="${PANEL_URL}" style="width:900px;height:700px"></iframe>
    <script>${hostScript(opts)}</script>
  </body></html>`;
  const file = path.join(os.tmpdir(), `office-panel-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(file, html);
  await page.goto('file://' + file);
  const frame = page.frame({ url: /panel\/index\.html/ });
  const readySelector = opts.surface === 'status' ? '.ao-checklist' : '#talk-draft';
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

browserTest('selected root state shows its own team and reply state', async () => {
  const sessions = [
    session('root-1', null, { title: 'Root task', outcome: 'completed' }),
    session('child', 'root-1', { title: 'Child task' }),
    session('grandchild', 'child', { title: 'Grandchild task', unread: true }),
    session('root-2', null, { title: 'Other root', activity: 'completed' }),
    session('child-2', 'root-2', { title: 'Other child' }),
  ];
  const { browser, frame } = await start({ sessions, readySession: { id: 'root-1', title: 'Root One', busy: false } });

  try {
  assert.equal(await subTitle(frame), 'Root One');
  assert.deepEqual((await visibleIds(frame)).sort(), ['child', 'grandchild', 'root-1']);
  const rootCard = await cards(frame).then(all => all.find(c => c.id === 'agent-root-1'));
  assert.match(rootCard.text, /Reply ready/);
  const grandCard = await cards(frame).then(all => all.find(c => c.id === 'agent-grandchild'));
  assert.match(grandCard.text, /Reply ready/);
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
  assert.deepEqual((await visibleIds(frame)).sort(), ['child', 'grandchild']);
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
  assert.deepEqual((await visibleIds(frame)).sort(), ['child', 'grandchild']);
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

browserTest('idle without unread is Idle; completed or unread is Reply ready', async () => {
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
  assert.doesNotMatch(byId.get('agent-root-1'), /Reply ready/);
  assert.match(byId.get('agent-done'), /Reply ready/);
  assert.match(byId.get('agent-unread'), /Reply ready/);
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

browserTest('Work Status surface renders the setup checklist and actions', async () => {
  const { browser, page, frame } = await start({ surface: 'status', sessions: [session('root-1', null, { outcome: 'completed' })] });
  try {
    await frame.getByText('Session access: Live updates connected.').waitFor({ timeout: 5000 });
    const checklist = await frame.locator('.ao-checklist').innerText();
    assert.match(checklist, /Project: Current project selected\./);
    assert.match(checklist, /Local service: OpenCode answered\./);
    assert.match(checklist, /Lead: lead/);
    assert.match(checklist, /Models: 2 available\./);
    assert.match(checklist, /Chat command: \/office is available\./);
    assert.equal(await frame.locator('button[data-action="copySetup"]').count(), 1);
    assert.equal(await frame.locator('button[data-view="settings"]').count(), 1);
    assert.equal(await frame.locator('button[data-view="office"]').count(), 1);
    await frame.locator('button[data-action="copySetup"]').click();
    await page.waitForTimeout(100);
    assert.equal((await page.evaluate(() => window.__clipboard)).length, 1);
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

browserTest('status and panel hide views that do not apply', async () => {
  const status = await start({ surface: 'status', sessions: [session('root-1', null)] });
  try {
    await status.frame.locator('.ao-checklist').waitFor({ timeout: 5000 });
    assert.equal(await status.frame.locator('.ao-tabs').count(), 0);
    assert.equal(await status.frame.locator('#talk-draft').count(), 0);
    await status.frame.locator('button[data-view="settings"]').click();
    await status.frame.locator('#setting-lead').waitFor({ timeout: 5000 });
    assert.equal(await status.frame.locator('.ao-checklist').count(), 0);
    assert.equal(await status.frame.getByText('Back to Work Status').count(), 1);
    await status.frame.getByText('Back to Work Status').click();
    assert.equal(await status.frame.locator('.ao-checklist').count(), 1);
  } finally { await status.browser.close(); }

  const panel = await start({ sessions: [session('root-1', null)] });
  try {
    await panel.frame.locator('#talk-draft').waitFor({ timeout: 5000 });
    assert.equal(await panel.frame.locator('.ao-checklist').count(), 0);
    assert.equal(await panel.frame.getByText('Back to Work Status').count(), 0);
    assert.equal(await panel.frame.locator('.ao-tabs').count(), 1);
  } finally { await panel.browser.close(); }
});
