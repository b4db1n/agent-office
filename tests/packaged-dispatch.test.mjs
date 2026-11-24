// Integration coverage of the SHIPPED artifacts: background/main.js bundle ->
// actual service/main.js over loopback -> synthetic `opencode` executable.
// The SDK here is a synthetic postMessage emulator, not the native desktop.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const HOST_FILE = new URL('./fixtures/office-host.mjs', import.meta.url).pathname;
const SERVICE_FILE = new URL('../service/main.js', import.meta.url).pathname;
const BACKGROUND_FILE = new URL('../background/main.js', import.meta.url).pathname;

async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

// Pure decision logic: a 401 is an authentication mismatch for this attempt,
// NOT evidence of an address collision. Only a confirmed child EADDRINUSE may
// retry with a fresh port. No other outcome is retryable.
export function serviceStartOutcome(healthStatus, stderrText) {
  if (healthStatus === 401) return {kind:'auth-mismatch',retry:false};
  if (/EADDRINUSE|address already in use/i.test(String(stderrText ?? ''))) {
    return {kind:'bind-collision',retry:true};
  }
  return {kind:'failure',retry:false};
}

// Failure messages never carry bearer values, tokens or long opaque strings.
export function sanitizeDiagnostic(text) {
  return String(text ?? '')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '[redacted]')
    .replace(/[A-Za-z0-9_+/=-]{20,}/g, '[redacted]')
    .slice(0, 400);
}

function activeChild(child) {
  return !!child && child.exitCode === null && child.signalCode === null;
}

function waitExit(child) {
  if (!activeChild(child)) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.once('error', resolve);
  });
}

// Only ever signal handles this suite created and tracked. SIGTERM first,
// bounded escalation for survivors; no process lookup or wildcard kill.
async function shutdown(children) {
  for (const child of children) {
    if (!activeChild(child)) continue;
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  const soft = Date.now() + 1500;
  while (Date.now() < soft && children.some(activeChild)) await delay(25);
  for (const child of children) {
    if (!activeChild(child)) continue;
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  const hard = Date.now() + 1000;
  while (Date.now() < hard && children.some(activeChild)) await delay(25);
}

async function isolate(t) {
  const owned = [];
  const root = await mkdtemp(join(tmpdir(), 'office-packaged-'));
  let cleaned = false;
  // Registered before any further provisioning: a failure below still cleans
  // up every child that was tracked and this temp root.
  t.after(async () => {
    if (cleaned) return;
    cleaned = true;
    await shutdown(owned);
    await rm(root, {recursive:true,force:true});
  });

  const project = join(root, 'project');
  await mkdir(project, {recursive:true});
  const { realpath } = await import('node:fs/promises');
  const dir = await realpath(project);
  const state = join(root, 'state');
  const bin = join(root, 'bin');
  const settings = join(root, 'settings.json');
  const record = join(root, 'host.jsonl');
  await mkdir(state, {recursive:true});
  await mkdir(bin, {recursive:true});
  await writeFile(join(bin,'opencode'),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(HOST_FILE)} "$@"\n`,
    {mode:0o755});

  let service = null;
  for (let attempt = 0; attempt < 3 && !service; attempt++) {
    const port = await freePort();
    const token = randomUUID();
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [SERVICE_FILE], {
      env: {
        ...process.env,
        PATH:`${bin}:${process.env.PATH}`,
        XDG_STATE_HOME:state,
        AGENT_OFFICE_SETTINGS_FILE:settings,
        AGENT_OFFICE_SERVER:base,
        OFFICE_HOST_RECORD:record,
        OFFICE_HOST_DIR:dir,
        OPENCHAMBER_SERVICE_PORT:String(port),
        OPENCHAMBER_SERVICE_TOKEN:token,
      },
      stdio:['ignore','ignore','pipe'],
    });
    owned.push(child); // tracked before readiness or settings provisioning
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => stderr.push(Buffer.from(String(error))));
    const auth = {authorization:`Bearer ${token}`,'content-type':'application/json'};

    let healthy = false, healthStatus = null;
    for (let i = 0; i < 60 && activeChild(child); i++) {
      try {
        const res = await fetch(`${base}/health`, {headers:auth});
        if (res.status === 200) { healthy = true; break; }
        if (res.status === 401) { healthStatus = 401; break; }
      } catch { /* retry while starting */ }
      await delay(50);
    }
    if (healthy) { service = {child,auth,base,token}; break; }

    const raw = Buffer.concat(stderr).toString();
    const decision = serviceStartOutcome(healthStatus, raw);
    await shutdown([child]);
    if (decision.kind === 'auth-mismatch') {
      // Terminal for this attempt: no retry, no settings, no dispatch.
      throw new Error('Packaged service rejected its credentials; no task was sent.');
    }
    if (decision.retry && attempt < 2) continue;
    throw new Error(`Packaged service did not start: ${sanitizeDiagnostic(raw)}`);
  }
  assert.ok(service, 'Packaged service did not start.');

  // Fixture provisioning only: configure through the real service route.
  // This does not exercise a bundled setup command or desktop installer.
  const configured = await fetch(`${service.base}/settings`, {
    method:'POST', headers:service.auth,
    body:JSON.stringify({directory:dir,scope:'project',values:{
      lead:'lead',leadModel:'opencode-go/beam-free',specialistModel:null,parallelism:1,budget:null,
    }}),
  });
  assert.equal(configured.status, 200, await configured.text());

  return {
    dir, base:service.base, auth:service.auth, token:service.token, state, bin,
    track:(child) => { owned.push(child); },
    async calls() {
      try {
        return (await readFile(record,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
      } catch { return []; }
    },
  };
}

async function waitFor(predicate, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error('Timed out waiting for synthetic SDK message.');
}

// Synthetic SDK host: drives the REAL background bundle through its postMessage
// protocol and forwards service-request calls to the REAL service bundle.
async function runBackground(env, item, options = {}) {
  const source = await readFile(BACKGROUND_FILE, 'utf8');
  const sent = [], requests = [], opens = [], toasts = [], results = [];
  let deliver;
  class MessageEventStub {
    constructor(type, init = {}) {
      this.type = type;
      this.data = init.data;
      this.source = init.source ?? null;
      this.origin = init.origin ?? '';
    }
  }
  const hostSide = {postMessage(message) { sent.push(message); queueMicrotask(() => onGuest(message)); }};
  const win = {
    parent:hostSide,
    addEventListener(type, cb) { if (type === 'message') deliver = cb; },
    removeEventListener() {},
    postMessage(message) {
      queueMicrotask(() => deliver?.(new MessageEventStub('message', {
        data:message, source:hostSide, origin:'*',
      })));
    },
    location:{href:'http://localhost/background/index.html'},
  };
  const documentStub = {
    documentElement:{hasAttribute:() => true,setAttribute(){},addEventListener(){}},
    addEventListener(){}, head:{appendChild(){}},
    createElement:() => ({setAttribute(){},style:{}}),
  };
  const sandbox = {
    window:win, self:win, document:documentStub, MessageEvent:MessageEventStub,
    Element:class {}, HTMLElement:class {},
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    console, URL, URLSearchParams, TextEncoder, TextDecoder,
    crypto:globalThis.crypto,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, {filename:'background/main.js'});

  const reply = (m, payload) => win.postMessage({
    channel:'openchamber.sdk', v:1, type:'result', id:m.id, ok:true, payload,
  });
  const fail = (m, code, error) => win.postMessage({
    channel:'openchamber.sdk', v:1, type:'result', id:m.id, ok:false, code, error,
  });

  async function onGuest(message) {
    if (message.channel !== 'openchamber.sdk') return;
    if (message.type === 'hello') {
      return reply(message, {
        theme:{mode:'dark',tokens:{}}, locale:'en', directory:env.dir,
        session:{id:item.sessionId,title:'Origin'}, surface:'background',
        connection:{connected:true,account:null}, settings:{}, item:null,
      });
    }
    if (message.type === 'action-result') { results.push(message.payload); return; }
    if (message.id === undefined) return;
    if (message.type === 'service-request') {
      const p = message.payload;
      requests.push({method:p.method,path:p.path,body:p.body ? JSON.parse(p.body) : null});
      if (options.serviceFail) return fail(message,'SERVICE_FAILED','Injected service failure.');
      const res = await fetch(env.base + p.path, {
        method:p.method,
        headers:{authorization:`Bearer ${env.token}`,'content-type':'application/json'},
        body:p.body,
      });
      return reply(message, {status:res.status,body:await res.text()});
    }
    if (message.type === 'open-session') {
      opens.push(message.payload.sessionId);
      return options.openFail
        ? fail(message,'OPEN_FAILED','Navigation unavailable.')
        : reply(message, undefined);
    }
    if (message.type === 'toast') { toasts.push(message.payload); return reply(message, undefined); }
    return reply(message, undefined);
  }

  await waitFor(() => sent.some((m) => m.type === 'hello'));
  const hello = sent.find((m) => m.type === 'hello');
  await delay(5);
  // The ready frame must carry the same id as hello for the SDK handshake.
  win.postMessage({
    channel:'openchamber.sdk', v:1, type:'ready', id:hello.id,
    payload:{
      theme:{mode:'dark',tokens:{}}, locale:'en', directory:env.dir,
      session:{id:item.sessionId,title:'Origin'}, surface:'background',
      connection:{connected:true,account:null}, settings:{}, item:null,
    },
  });
  await delay(10);
  win.postMessage({channel:'openchamber.sdk',v:1,type:'action',id:'action-1',payload:item});
  await waitFor(() => results.length > 0);
  return {sent,requests,opens,toasts,results};
}

const action = (overrides = {}) => ({
  kind:'message', action:'dispatch', role:'user', directory:null,
  sessionId:'ses_origin', messageId:'msg_origin', text:'Write a triangle test.',
  ...overrides,
});

test('packaged background -> service -> synthetic host confirms one new root', async t => {
  const env = await isolate(t);
  const item = action({directory:env.dir});
  const out = await runBackground(env, item);
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].ok, true);
  assert.equal(out.requests.length, 1);
  const request = out.requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/dispatch');
  assert.equal(request.body.directory, env.dir);
  assert.equal(request.body.prompt, item.text);
  assert.deepEqual(request.body.origin, {sessionId:'ses_origin',messageId:'msg_origin'});
  assert.equal(out.toasts.length, 0);

  const calls = await env.calls();
  const creates = calls.filter(c => c.path === '/api/session' && c.method === 'POST');
  const prompts = calls.filter(c => c.path.endsWith('/prompt') && c.method === 'POST');
  assert.equal(creates.length, 1);
  assert.equal(prompts.length, 1);
  assert.equal(creates[0].data.agent, 'lead');
  assert.deepEqual(creates[0].data.model, {providerID:'opencode-go',id:'beam-free'});
  assert.deepEqual(creates[0].data.metadata.agentOfficeOrigin, request.body.origin);
  assert.equal(creates[0].data.location.directory, env.dir);
  assert.equal(prompts[0].data.text, item.text);
  assert.ok(creates[0].data.id.startsWith('ses_'));
  // open-session used the confirmed root from the service result, not the caller.
  assert.equal(out.opens[0], creates[0].data.id);
});

test('navigation failure yields an informational toast and never a second send', async t => {
  const env = await isolate(t);
  const out = await runBackground(env, action({directory:env.dir}), {openFail:true});
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].ok, true);
  assert.equal(out.requests.length, 1);
  assert.equal(out.opens.length, 1);
  assert.equal(out.toasts.length, 1);
  assert.match(out.toasts[0].message, /session list/);
  assert.doesNotMatch(out.toasts[0].message, /retry|resend/i);
  const calls = await env.calls();
  assert.equal(calls.filter(c => c.path === '/api/session' && c.method === 'POST').length, 1);
  assert.equal(calls.filter(c => c.path.endsWith('/prompt')).length, 1);
});

test('service failure and malformed actions never dispatch', async t => {
  const env = await isolate(t);
  const failed = await runBackground(env, action({directory:env.dir}), {serviceFail:true});
  assert.equal(failed.results[0]?.ok, false);
  assert.equal(failed.opens.length, 0);
  assert.equal((await env.calls()).length, 0);

  for (const bad of [
    action({directory:env.dir, action:'other'}),
    action({directory:env.dir, role:'assistant'}),
    action({kind:'user', directory:env.dir}),
    action({directory:null}),
  ]) {
    const out = await runBackground(env, bad);
    assert.equal(out.results[0]?.ok, false);
    assert.equal(out.requests.length, 0);
  }
  assert.equal((await env.calls()).length, 0);
});

test('packaged plugin registers once and emits a synthetic resume:false notice', async t => {
  const env = await isolate(t);
  const pluginState = join(env.state, 'plugin');
  const pluginRecord = join(env.state, 'plugin-host.jsonl');
  await mkdir(pluginState, {recursive:true});
  const child = spawn(process.execPath, [HOST_FILE, '--plugin'], {
    env: {
      ...process.env,
      PATH:`${env.bin}:${process.env.PATH}`,
      XDG_STATE_HOME:pluginState,
      AGENT_OFFICE_SETTINGS_FILE:join(pluginState,'settings.json'),
      AGENT_OFFICE_SERVER:env.base,
      OFFICE_HOST_RECORD:pluginRecord,
      OFFICE_HOST_DIR:env.dir,
      OFFICE_PLUGIN_INPUT:JSON.stringify({
        directory:env.dir, sessionID:'ses_caller', text:'plugin task',
      }),
    },
    stdio:['ignore','pipe','pipe'],
  });
  env.track(child); // owned by the suite before any waiting
  const stdout = [], stderr = [];
  child.stdout.on('data', (c) => stdout.push(c));
  child.stderr.on('data', (c) => stderr.push(c));
  child.on('error', (e) => stderr.push(Buffer.from(String(e))));
  const evidence = () =>
    `stdout=${Buffer.concat(stdout).toString().slice(0,800)} stderr=${Buffer.concat(stderr).toString().slice(0,800)}`;
  const outcome = await Promise.race([
    waitExit(child).then(() => 'exited'),
    delay(5000).then(() => 'timeout'),
  ]);
  if (outcome !== 'exited') {
    await shutdown([child]);
    throw new Error(`Plugin child timed out. ${evidence()}`);
  }
  assert.equal(child.exitCode, 0, evidence());
  let out;
  try { out = JSON.parse(Buffer.concat(stdout).toString()); }
  catch { throw new Error(`Plugin child produced invalid JSON. ${evidence()}`); }

  assert.equal(out.id, 'agent-office');
  assert.equal(out.transforms, 1);
  assert.deepEqual(out.registered, ['office']);
  assert.equal(out.duplicateBlocked, true);
  assert.equal(out.error, null);
  const creates = out.calls.filter(c => c.path === '/api/session' && c.method === 'POST');
  assert.equal(creates.length, 1);
  assert.equal(creates[0].data.agent, 'lead');
  assert.equal(out.calls.filter(c => c.path.endsWith('/prompt')).length, 1);
  assert.equal(out.synthetic.length, 1);
  assert.equal(out.synthetic[0].sessionID, 'ses_caller');
  assert.equal(out.synthetic[0].resume, false);
  assert.match(out.synthetic[0].text, /Agent Office: task sent/);
  assert.match(out.synthetic[0].text, /Lead: lead/);
  assert.match(out.synthetic[0].text, new RegExp(creates[0].data.id));
  assert.doesNotMatch(out.synthetic[0].text, /prompt/i);
});

test('401 is a terminal auth mismatch; only child EADDRINUSE permits a retry', async t => {
  const bind = 'Error: listen EADDRINUSE: address already in use 127.0.0.1:43210';
  assert.deepEqual(serviceStartOutcome(401, bind), {kind:'auth-mismatch',retry:false});
  assert.deepEqual(serviceStartOutcome(null, bind), {kind:'bind-collision',retry:true});
  assert.deepEqual(serviceStartOutcome(null, 'listen EACCES permission denied'), {kind:'failure',retry:false});
  assert.deepEqual(serviceStartOutcome(503, ''), {kind:'failure',retry:false});
  const sanitized = sanitizeDiagnostic('Bearer placeholder-credential 12345678-1234-1234-1234-123456789012');
  assert.equal(sanitized.includes('placeholder-credential'), false);
  assert.equal(sanitized.includes('12345678'), false);

  // Our own service returns 401 for a wrong credential; no foreign service.
  const env = await isolate(t);
  const res = await fetch(`${env.base}/health`, {headers:{authorization:'Bearer wrong-credential'}});
  assert.equal(res.status, 401);
  assert.deepEqual(serviceStartOutcome(res.status, ''), {kind:'auth-mismatch',retry:false});
  assert.equal((await env.calls()).length, 0);
});
