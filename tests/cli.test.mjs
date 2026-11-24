import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command } from '../companion/cli.mjs';

async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'office-cli-')));
  return {dir, async cleanup() { await rm(dir, {recursive:true,force:true}); }};
}

const session = (dir, id, parentID) => ({
  id, projectID:'prj', location:{directory:dir}, title:id,
  ...(parentID ? {parentID} : {}),
});

function harness(f, {children = {}, active = {}, forms = {}, permissions = {}, failures = {}, roots = {}} = {}) {
  const calls = [];
  const api = async (method, path, params = {}) => {
    calls.push(`${method} ${path}`);
    const key = `${method} ${path}`;
    if (Object.hasOwn(failures, key)) throw failures[key];
    if (Object.hasOwn(roots, path)) return roots[path];
    if (path === '/api/session' && params.parentID) return children[params.parentID] ?? [];
    if (path === '/api/session/active') return active;
    if (path.endsWith('/form')) return forms[path] ?? [];
    if (path.endsWith('/permission')) return permissions[path] ?? [];
    throw new Error(`Unexpected host call: ${key}`);
  };
  return {api, calls};
}

const teamArgs = (f, rootId = 'ses_root') => ['team', rootId, f.dir];

test('team reports a valid running session and known empty waiting', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const {api} = harness(f, {
    roots:{'/api/session/ses_root':session(f.dir,'ses_root')},
    active:{'ses_root':{type:'running'}},
  });
  const out = await command(teamArgs(f), api);
  assert.equal(out.partial, false);
  assert.deepEqual(out.sessions.map(s => s.id), ['ses_root']);
  assert.equal(out.sessions[0].active, true);
  assert.deepEqual(out.sessions[0].waiting, {forms:[],permissions:[]});
});

test('a valid empty active map is known empty, not partial', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const {api} = harness(f, {roots:{'/api/session/ses_root':session(f.dir,'ses_root')}, active:{}});
  const out = await command(teamArgs(f), api);
  assert.equal(out.partial, false);
  assert.equal(out.sessions[0].active, false);
});

test('non-object active responses are unknown and partial', async t => {
  for (const active of [[], 42, null, 'busy', true]) {
    const f = await fixture(); t.after(() => f.cleanup());
    const {api} = harness(f, {roots:{'/api/session/ses_root':session(f.dir,'ses_root')}, active});
    const out = await command(teamArgs(f), api);
    assert.equal(out.sessions[0].active, null, `active=${JSON.stringify(active)}`);
    assert.equal(out.partial, true, `active=${JSON.stringify(active)}`);
  }
});

test('malformed active entries are unknown and partial', async t => {
  for (const active of [{'ses_root':42}, {'ses_root':{type:'idle'}}, {'ses_root':null}, {'ses_root':{}}]) {
    const f = await fixture(); t.after(() => f.cleanup());
    const {api} = harness(f, {roots:{'/api/session/ses_root':session(f.dir,'ses_root')}, active});
    const out = await command(teamArgs(f), api);
    assert.equal(out.sessions[0].active, null);
    assert.equal(out.partial, true);
  }
});

test('failed active or waiting reads yield null with partial, never false or empty', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const rootPath = '/api/session/ses_root';
  const {api} = harness(f, {
    roots:{[rootPath]:session(f.dir,'ses_root')},
    active:{'ses_root':{type:'running'}},
    failures:{'GET /api/session/active':new Error('offline')},
  });
  const noActive = await command(teamArgs(f), api);
  assert.equal(noActive.sessions[0].active, null);
  assert.equal(noActive.partial, true);

  const f2 = await fixture(); t.after(() => f2.cleanup());
  const {api:api2} = harness(f2, {
    roots:{'/api/session/ses_root':session(f2.dir,'ses_root')},
    active:{'ses_root':{type:'running'}},
    failures:{'GET /api/session/ses_root/form':new Error('offline')},
  });
  const noForms = await command(teamArgs(f2), api2);
  assert.equal(noForms.sessions[0].waiting.forms, null);
  assert.deepEqual(noForms.sessions[0].waiting.permissions, []);
  assert.equal(noForms.partial, true);
});

test('foreign or malformed waiting rows are rejected with partial and no text leak', async t => {
  for (const rows of [
    [{id:'f1',sessionID:'ses_other',title:'secret fixture'}],
    [{id:'f1',title:'secret fixture'}],
    'not-an-array',
  ]) {
    const f = await fixture(); t.after(() => f.cleanup());
    const {api} = harness(f, {
      roots:{'/api/session/ses_root':session(f.dir,'ses_root')},
      active:{'ses_root':{type:'running'}},
      forms:{'/api/session/ses_root/form':rows},
    });
    const out = await command(teamArgs(f), api);
    assert.equal(out.sessions[0].waiting.forms, null);
    assert.equal(out.partial, true);
    assert.ok(!JSON.stringify(out).includes('secret'));
  }
});

test('valid waiting rows keep only minimal display fields', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const {api} = harness(f, {
    roots:{'/api/session/ses_root':session(f.dir,'ses_root')},
    forms:{'/api/session/ses_root/form':[
      {id:'f1',sessionID:'ses_root',title:'Approve?',body:'LEAKME_body',text:'LEAKME_text'},
    ]},
    permissions:{'/api/session/ses_root/permission':[
      {id:'p1',sessionID:'ses_root',action:'read',prompt:'LEAKME_prompt'},
    ]},
  });
  const out = await command(teamArgs(f), api);
  assert.deepEqual(out.sessions[0].waiting.forms, [{id:'f1',title:'Approve?'}]);
  assert.deepEqual(out.sessions[0].waiting.permissions, [{id:'p1',action:'read'}]);
  assert.ok(!JSON.stringify(out).includes('LEAKME'));
});

test('team stays isolated to the selected root', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const a = 'ses_rootA', b = 'ses_rootB';
  const {api} = harness(f, {
    roots:{
      [`/api/session/${a}`]:session(f.dir,a),
      [`/api/session/${b}`]:session(f.dir,b),
    },
    children:{
      [a]:[session(f.dir,'ses_childA',a), {...session(f.dir,'ses_foreign',a),projectID:'prj_other'}],
      [b]:[session(f.dir,'ses_childB',b)],
    },
  });
  const first = await command(teamArgs(f, a), api);
  const second = await command(teamArgs(f, b), api);
  assert.deepEqual(first.sessions.map(s => s.id), [a,'ses_childA']);
  assert.deepEqual(second.sessions.map(s => s.id), [b,'ses_childB']);
  assert.equal(first.partial, false); // positive foreign exclusion is not a lost read
  assert.equal(second.partial, false);
});

test('stop rejects an out-of-team target before any interrupt', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const {api, calls} = harness(f, {
    roots:{'/api/session/ses_root':session(f.dir,'ses_root')},
    children:{ses_root:[session(f.dir,'ses_child','ses_root')]},
  });
  await assert.rejects(
    command(['stop','ses_elsewhere','--root','ses_root','--directory',f.dir], api),
    /outside the selected Office team/,
  );
  assert.ok(!calls.some(c => c.includes('interrupt')));
});
