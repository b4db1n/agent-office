import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { inspect, settingsView, saveSettings, SETTINGS_KEYS } from '../shared/settings.mjs';

test('settings keys are exported', () => {
  assert.equal(Array.isArray(SETTINGS_KEYS), true);
  assert.equal(SETTINGS_KEYS.length, 12);
});

test('saveSettings validates departments and the advisor', async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'office-'));
  process.env.AGENT_OFFICE_SETTINGS_FILE = path.join(stateDir, 'settings.json');
  const dir = process.cwd();
  await assert.rejects(() => saveSettings(dir, 'project', { departments: [{ name: 'Research' }] }), /lead agent/i);
  await assert.rejects(() => saveSettings(dir, 'project', { advisor: 7 }), /advisor must be a string/i);
  await saveSettings(dir, 'project', {
    advisor: 'reviewer',
    departments: [{ id: 'Research Lab', name: 'Research Lab', lead: 'lead', members: ['helper', 'helper'] }],
  });
  const view = await settingsView(dir);
  assert.equal(view.settings.advisor, 'reviewer');
  assert.deepEqual(view.settings.departments, [
    { id: 'research-lab', name: 'Research Lab', purpose: '', lead: 'lead', members: ['helper'] },
  ]);
  delete process.env.AGENT_OFFICE_SETTINGS_FILE;
});

test('saveSettings validates scope', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-'));
  await assert.rejects(() => saveSettings(dir, 'bogus', {}), /scope/i);
});

test('saveSettings validates unknown keys', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-'));
  await assert.rejects(() => saveSettings(dir, 'global', { nope: 1 }), /Unknown settings key/);
});

test('saveSettings preserves zero', async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'office-'));
  process.env.AGENT_OFFICE_SETTINGS_FILE = path.join(stateDir, 'settings.json');
  const dir = process.cwd();
  await saveSettings(dir, 'global', { parallelism: 0, budget: 0 });
  const result = await settingsView(dir);
  assert.equal(result.global.parallelism, 0);
  assert.equal(result.global.budget, 0);
  assert.equal(result.settings.parallelism, 0);
  delete process.env.AGENT_OFFICE_SETTINGS_FILE;
});

test('saveSettings project override', async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'office-'));
  process.env.AGENT_OFFICE_SETTINGS_FILE = path.join(stateDir, 'settings.json');
  const dir = process.cwd();
  await saveSettings(dir, 'global', { lead: 'global-lead' });
  await saveSettings(dir, 'project', { lead: 'project-lead' });
  const result = await settingsView(dir);
  assert.equal(result.global.lead, 'global-lead');
  assert.equal(result.project.lead, 'project-lead');
  assert.equal(result.settings.lead, 'project-lead');
  assert.equal(result.sources.lead, 'project');
  delete process.env.AGENT_OFFICE_SETTINGS_FILE;
});

test('discovery only performs scoped GETs and hides private agent fields', async () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'office-discovery-')));
  const read = [];
  const responses = {
    '/api/agent': [{ id: 'lead', mode: 'primary', request: 'synthetic-private', prompt: 'synthetic-private', model: { id: 'demo', providerID: 'sample', variant: 'max', extra: 'synthetic-private' } }],
    '/api/model': [{ id: 'demo', providerID: 'sample', enabled: true }],
    '/api/model/default': { id: 'demo', providerID: 'sample' },
    '/api/plugin': [{ id: 'agent-office',state:{status:'active'} }],
  };
  const info = await inspect(dir, {
    run: async (_executable, [api, method, url]) => {
      assert.equal(api, 'api');
      assert.equal(method, 'get');
      const endpoint = new URL(url, 'http://localhost');
      assert.equal(endpoint.searchParams.get('location[directory]'), dir);
      read.push(endpoint.pathname);
      return { stdout: JSON.stringify({ location: { directory: dir }, data: responses[endpoint.pathname] }) };
    },
  });
  assert.deepEqual(read.sort(), Object.keys(responses).sort());
  assert.deepEqual(info.agents, [{ id: 'lead', mode: 'primary', hidden: false, subagentOnly: false, model: { providerID: 'sample', id: 'demo', variant: 'max' } }]);
  assert.equal(info.agentDiscovery, 'ready');
  assert.equal(info.plugin, true);
  assert.equal(JSON.stringify(info.agents).includes('synthetic-private'), false);
});

test('unavailable and empty discovery do not cause a write or look the same', async () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'office-empty-')));
  let requests = 0;
  const info = await inspect(dir, {
    run: async (_exe, [api, method, url]) => {
      requests++;
      assert.equal(api, 'api');
      assert.equal(method, 'get');
      if (url.startsWith('/api/agent?')) throw new Error('location warming');
      return { stdout: JSON.stringify({ location: { directory: dir }, data: [] }) };
    },
  });
  assert.equal(requests, 4);
  assert.equal(info.agentDiscovery, 'unavailable');
  assert.equal(info.modelDiscovery, 'empty');
  assert.equal(info.plugin, false);
});

test('simultaneous saves preserve disjoint fields and inherit is not an explicit default', async (t) => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'office-concurrent-'));
  const old = process.env.AGENT_OFFICE_SETTINGS_FILE;
  process.env.AGENT_OFFICE_SETTINGS_FILE = path.join(stateDir, 'settings.json');
  t.after(() => {
    if (old === undefined) delete process.env.AGENT_OFFICE_SETTINGS_FILE;
    else process.env.AGENT_OFFICE_SETTINGS_FILE = old;
  });
  const dir = process.cwd();
  await saveSettings(dir, 'global', { budget: 5, agentModels: { lead: 'sample/old', reviewer: 'sample/free' } });
  await Promise.all([
    saveSettings(dir, 'project', { budget: 0 }),
    saveSettings(dir, 'project', { lead: 'lead', agentModels: { lead: 'sample/new#max' } }),
  ]);
  let view = await settingsView(dir);
  assert.equal(view.settings.budget, 0);
  assert.equal(view.settings.lead, 'lead');
  assert.deepEqual(view.settings.agentModels, { lead: 'sample/new#max', reviewer: 'sample/free' });
  await saveSettings(dir, 'project', { budget: null });
  view = await settingsView(dir);
  assert.equal(view.settings.budget, null);
  assert.equal(view.sources.budget, 'project (explicit default)');
  await saveSettings(dir, 'project', {}, ['budget']);
  view = await settingsView(dir);
  assert.equal(view.settings.budget, 5);
  assert.equal(view.sources.budget, 'global');
});
