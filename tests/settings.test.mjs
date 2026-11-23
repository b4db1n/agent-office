import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { settingsView, saveSettings, SETTINGS_KEYS } from '../shared/settings.mjs';

test('settings keys are exported', () => {
  assert.equal(Array.isArray(SETTINGS_KEYS), true);
  assert.equal(SETTINGS_KEYS.length, 10);
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