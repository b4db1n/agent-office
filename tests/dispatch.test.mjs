import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { dispatch } from '../shared/dispatch.mjs';
import { saveSettings, settingsView } from '../shared/settings.mjs';
import { addLessons } from '../shared/lessons.mjs';

const LEAD = { id: 'lead', mode: 'primary' };
const MODELS = [
  { id: 'beam-free', modelID: 'beam-free', providerID: 'opencode-go', enabled: true, cost: [{ input: 0, output: 0 }] },
];

async function makeFixture(extraModels = []) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'office-dispatch-')));
  const state = await mkdtemp(join(tmpdir(), 'office-dispatch-state-'));
  process.env.AGENT_OFFICE_SETTINGS_FILE = join(state, 'settings.json');
  process.env.AGENT_OFFICE_LESSONS_FILE = join(state, 'lessons.json');
  process.env.XDG_STATE_HOME = state;
  return {
    dir,
    state,
    models: [...MODELS, ...extraModels],
    async inspectFn() {
      const view = await settingsView(dir);
      return {
        agents: [LEAD],
        models: this.models.map((model) => `${model.providerID}/${model.id}`),
        ...view,
        plugin: false,
      };
    },
  };
}

function fakeRunner(fixture, calls, hook = null) {
  return async (_command, args) => {
    const line = args.join(' ');
    calls.push(line);
    if (line.includes('/api/model/default')) return { stdout: JSON.stringify({ data: null }) };
    if (line.includes('/api/model')) return { stdout: JSON.stringify({ location:{directory:fixture.dir}, data: fixture.models }) };
    if (line.includes('/api/session/active')) return { stdout: JSON.stringify({ data: {} }) };
    if (args[1] === 'POST' && args[2] === '/api/session') {
      return { stdout: JSON.stringify({ data: { ...JSON.parse(args[4]), id: 'ses_test123' } }) };
    }
    if (line.includes('/prompt')) {
      if (hook?.entered) hook.entered();
      if (hook?.gate) await hook.gate;
      return { stdout: JSON.stringify({data:{sessionID:'ses_test123'}}) };
    }
    if (args[1] === 'GET' && args[2]?.startsWith('/api/session/')) {
      return {
        stdout: JSON.stringify({
          data: {
            id: 'ses_test123',
            projectID:'p',
            location: { directory: fixture.dir },
            outcome: hook?.sessionRunning ? null : 'succeeded',
          },
        }),
      };
    }
    if (args[1] === 'GET' && args[2]?.startsWith('/api/session?')) return { stdout: JSON.stringify({ data: [] }) };
    throw new Error(`Unexpected host call: ${line}`);
  };
}

async function cleanup(fixture) {
  delete process.env.AGENT_OFFICE_SETTINGS_FILE;
  delete process.env.AGENT_OFFICE_LESSONS_FILE;
  delete process.env.XDG_STATE_HOME;
  await rm(fixture.dir, { recursive: true, force: true });
  await rm(fixture.state, { recursive: true, force: true });
}

async function configure(fixture, values) {
  await saveSettings(fixture.dir, 'project', {
    lead: 'lead',
    leadModel: 'opencode-go/beam-free',
    parallelism: 1,
    budget: null,
    ...values,
  });
}

test('dispatch rejects a non-absolute directory', async () => {
  await assert.rejects(dispatch('relative/dir', 'do work'), /project directory/i);
});

test('dispatch creates a fresh lead root and sends the task', async () => {
  const fixture = await makeFixture();
  const calls = [];
  try {
    await configure(fixture, { specialistModel: 'opencode-go/beam-free' });
    const result = await dispatch(fixture.dir, 'Add a double function.', {
      run: fakeRunner(fixture, calls),
      inspectFn: () => fixture.inspectFn(),
    });
    assert.equal(result.sessionId, 'ses_test123');
    assert.equal(result.lead, 'lead');
    assert.equal(result.requestedLeadModel, 'opencode-go/beam-free');
    assert.equal(result.preferredSpecialistModel, 'opencode-go/beam-free');
    assert.equal(result.directory, fixture.dir);
    assert.ok(calls.some((call) => call.includes('POST /api/session ')));
    assert.ok(calls.some((call) => call.includes('/api/session/ses_test123/prompt')));
  } finally {
    await cleanup(fixture);
  }
});

test('dispatch refuses unknown cost with a finite budget', async () => {
  const fixture = await makeFixture([{id:'unknown',providerID:'p',enabled:true,cost:[]}]);
  try {
    await configure(fixture, { leadModel: 'p/unknown', budget:1 });
    await assert.rejects(
      dispatch(fixture.dir, 'do work', {
        run: fakeRunner(fixture, []),
        inspectFn: () => fixture.inspectFn(),
      }),
      /cost is unknown/i,
    );
  } finally {
    await cleanup(fixture);
  }
});

test('zero budget cannot admit an unbounded specialist via a free lead', async () => {
  const fixture = await makeFixture();
  try {
    await configure(fixture, { budget: 0 });
    const calls = [];
    await assert.rejects(dispatch(fixture.dir, 'do work', {
      run: fakeRunner(fixture, calls),
      inspectFn: () => fixture.inspectFn(),
    }), /cannot bound delegated costs/);
    assert.ok(!calls.some(c => c.includes('POST')));
  } finally {
    await cleanup(fixture);
  }
});

test('the ledger lives in private user state, not the project', async () => {
  const fixture = await makeFixture();
  try {
    await configure(fixture, {});
    await dispatch(fixture.dir, 'do work', {
      run: fakeRunner(fixture, []),
      inspectFn: () => fixture.inspectFn(),
    });
    const key = createHash('sha256').update(fixture.dir).digest('hex').slice(0, 24);
    const ledger = JSON.parse(
      await readFile(join(fixture.state, 'agent-office', 'ledgers', `${key}.json`), 'utf8'),
    );
    assert.equal(ledger.roots.length, 1);
    assert.equal(ledger.roots[0].sessionId, 'ses_test123');
  } finally {
    await cleanup(fixture);
  }
});

test('dispatch refuses a paid model over a tiny budget', async () => {
  const fixture = await makeFixture([
    { id: 'paid', modelID: 'paid', providerID: 'p', enabled: true, cost: [{ input: 1, output: 1 }] },
  ]);
  try {
    await configure(fixture, { leadModel: 'p/paid', budget: 0.001 });
    await assert.rejects(
      dispatch(fixture.dir, 'do work', {
        run: fakeRunner(fixture, []),
        inspectFn: () => fixture.inspectFn(),
      }),
      /Budget exceeded/,
    );
  } finally {
    await cleanup(fixture);
  }
});

test('parallelism limit refuses a second live dispatch', async () => {
  const fixture = await makeFixture();
  try {
    await configure(fixture, { parallelism: 1 });
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const atPrompt = new Promise((resolve) => { entered = resolve; });
    const first = dispatch(fixture.dir, 'first task', {
      run: fakeRunner(fixture, [], { gate, entered, sessionRunning: true }),
      inspectFn: () => fixture.inspectFn(),
    });
    await atPrompt;
    await assert.rejects(
      dispatch(fixture.dir, 'second task', {
        run: fakeRunner(fixture, [], { sessionRunning: true }),
        inspectFn: () => fixture.inspectFn(),
      }),
      /Parallelism limit/,
    );
    release();
    assert.equal((await first).sessionId, 'ses_test123');
  } finally {
    await cleanup(fixture);
  }
});

test('variant, origin and message replay survive across dispatch callers', async t => {
  const f = await makeFixture([{id:'model',providerID:'p',enabled:true,variants:[{id:'max'}],cost:[]}]);
  t.after(()=>cleanup(f));
  await configure(f,{leadModel:'p/model#max',budget:null});
  const origin = {sessionId:'ses_test123',messageId:'msg_origin'};
  const calls=[];
  const opts={inspectFn:()=>f.inspectFn(),run:fakeRunner(f,calls),origin};
  const result=await dispatch(f.dir,'once',opts);
  assert.equal(result.requestedLeadModel,'p/model#max');
  const body=JSON.parse(calls.find(s=>s.startsWith('api POST /api/session --data ')).split(' --data ')[1]);
  assert.equal(body.model.variant,'max');
  assert.deepEqual(body.metadata.agentOfficeOrigin,origin);
  assert.ok(!('parentID' in body));
  await assert.rejects(dispatch(f.dir,'once',opts),/already submitted/);
  assert.equal(calls.filter(s=>s.includes('POST /api/session ')).length,1);
});

test('pending creation holds a slot; definite rejection refunds it; uncertain delivery does not', async t => {
  const f=await makeFixture(); t.after(()=>cleanup(f)); await configure(f,{});
  const calls=[], base=fakeRunner(f,calls);
  let enter,release;
  const reached=new Promise(r=>enter=r), gate=new Promise(r=>release=r);
  const opts={inspectFn:()=>f.inspectFn(),run:async (cmd,args)=>{
    if(args[1]==='POST' && args[2]==='/api/session'){enter();await gate;throw Object.assign(new Error(),{status:422});}
    return base(cmd,args);
  }};
  const first=dispatch(f.dir,'first',opts);
  await reached;
  await assert.rejects(dispatch(f.dir,'second',{...opts,run:base}),/Parallelism limit/);
  release(); await assert.rejects(first,/host rejected/);
  await assert.rejects(dispatch(f.dir,'third',{...opts,run:(c,a)=>a[2].endsWith('/prompt')?Promise.reject(new Error('timeout')):base(c,a)}),/Delivery uncertain/);
  const lostReads=(c,a)=>a[2].startsWith('/api/session/ses_')?Promise.reject(new Error('offline')):base(c,a);
  await assert.rejects(dispatch(f.dir,'third',{...opts,run:lostReads}),/uncertain/);
  assert.equal(calls.filter(c=>c.includes('POST /api/session ')).length,1);
});

test('same-origin replay reports pending in flight and submitted after ACK', async t => {
  const f=await makeFixture(); t.after(()=>cleanup(f)); await configure(f,{});
  const calls=[], base=fakeRunner(f,calls);
  const origin={sessionId:'ses_test123',messageId:'msg_pending'};
  const opts={inspectFn:()=>f.inspectFn(),origin};
  let enter,release;
  const reached=new Promise(r=>enter=r), gate=new Promise(r=>release=r);
  const first=dispatch(f.dir,'first',{...opts,run:async(c,a)=>{
    if(String(a[2]).endsWith('/prompt')){enter();await gate;}
    return base(c,a);
  }});
  await reached;
  const pending=await dispatch(f.dir,'replay',{...opts,run:base}).catch(e=>e);
  assert.match(pending.message,/pending/i);
  assert.match(pending.message,/ses_test123/);
  assert.doesNotMatch(pending.message,/already submitted/i);
  release();
  assert.equal((await first).sessionId,'ses_test123');
  const done=await dispatch(f.dir,'replay',{...opts,run:base}).catch(e=>e);
  assert.match(done.message,/already submitted/i);
  assert.equal(calls.filter(c=>c.includes('POST /api/session ')).length,1);
  assert.equal(calls.filter(c=>c.includes('/prompt')).length,1);
});

test('same-origin replay after a lost ACK reports uncertain, not submitted', async t => {
  const f=await makeFixture(); t.after(()=>cleanup(f)); await configure(f,{});
  const calls=[], base=fakeRunner(f,calls);
  const attempted=[], confirmed=[];
  const origin={sessionId:'ses_test123',messageId:'msg_uncertain'};
  const opts={inspectFn:()=>f.inspectFn(),origin};
  const lostAck=async(c,a)=>{
    const line=a.join(' ');
    if(line.includes('/prompt')){
      // Record at the transport boundary: the send was attempted, but no
      // response came back, so receipt was never confirmed.
      calls.push(line);
      attempted.push(line);
      throw new Error('ACK lost');
    }
    const out=await base(c,a);
    if(line.includes('/prompt')) confirmed.push(line);
    return out;
  };
  await assert.rejects(dispatch(f.dir,'first',{...opts,run:lostAck}),/Delivery uncertain/);
  assert.equal(attempted.length,1);
  assert.equal(confirmed.length,0);
  const replay=await dispatch(f.dir,'replay',{...opts,run:base}).catch(e=>e);
  assert.match(replay.message,/uncertain/i);
  assert.match(replay.message,/ses_test123/);
  assert.doesNotMatch(replay.message,/already submitted/i);
  assert.equal(calls.filter(c=>c.includes('POST /api/session ')).length,1);
  assert.equal(calls.filter(c=>c.includes('/prompt')).length,1);
  assert.equal(attempted.length,1); // no second attempted send
  assert.equal(confirmed.length,0); // still no confirmed receipt
});

test('a department dispatch carries its team and journal lessons', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture));
  await configure(fixture, {
    departments: [{ id: 'engineering', name: 'Engineering', purpose: 'Fix the product', lead: 'lead', members: [] }],
  });
  await addLessons(fixture.dir, 'engineering', ['Run the full suite before claiming a fix works.'], null);
  const calls = [];
  await dispatch(fixture.dir, 'Fix the login.', {
    run: fakeRunner(fixture, calls),
    inspectFn: () => fixture.inspectFn(),
    departmentId: 'engineering',
  });
  const promptCall = calls.find((call) => call.includes('/prompt') && call.startsWith('api POST'));
  const text = JSON.parse(promptCall.split(' --data ')[1]).text;
  assert.match(text, /^Fix the login\./);
  assert.match(text, /Office department: Engineering — Fix the product/);
  assert.match(text, /Run the full suite before claiming a fix works\./);
  const key = createHash('sha256').update(fixture.dir).digest('hex').slice(0, 24);
  const ledger = JSON.parse(await readFile(join(fixture.state, 'agent-office', 'ledgers', `${key}.json`), 'utf8'));
  assert.equal(ledger.roots[0].department, 'engineering');
});

test('an unknown department refuses instead of switching teams', async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanup(fixture));
  await configure(fixture, {
    departments: [{ id: 'engineering', name: 'Engineering', lead: 'lead', members: [] }],
  });
  const calls = [];
  await assert.rejects(dispatch(fixture.dir, 'Do work.', {
    run: fakeRunner(fixture, calls),
    inspectFn: () => fixture.inspectFn(),
    departmentId: 'missing',
  }), /department is not configured/i);
  assert.equal(calls.filter((call) => call.includes('POST /api/session ')).length, 0);
});
