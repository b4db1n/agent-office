import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../companion/setup.mjs';

test('preview writes nothing; apply twice preserves custom definitions and avoids shadowing host agents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'office-test-'));
  const agents = [{ id: 'reviewer', mode: 'subagent' }];
  await install(dir, ['--templates'], agents);
  assert.deepEqual(await readdir(dir), []);
  const defs = join(dir, '.opencode', 'agents');
  await mkdir(defs, { recursive: true });
  await writeFile(join(defs, 'lead.md'), 'custom\n');
  await install(dir, ['--templates', '--apply'], agents);
  const second = await install(dir, ['--templates', '--apply'], agents);
  assert.ok(second.files.every((row) => row.status !== 'created'));
  assert.equal(await readFile(join(defs, 'lead.md'), 'utf8'), 'custom\n');
  assert.deepEqual((await readdir(defs)).sort(), ['implementer.md', 'lead.md']);
});

test('setup rejects a redirected project configuration directory before writing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'office-link-'));
  const elsewhere = await mkdtemp(join(tmpdir(), 'office-target-'));
  await symlink(elsewhere, join(dir, '.opencode'));
  await assert.rejects(install(dir, ['--apply', '--templates'], []), /symbolic link/);
  assert.deepEqual(await readdir(elsewhere), []);
});

test('plugin install uses exclusive create and does not overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'office-plugin-'));
  const first = await install(dir, ['--plugin', '--apply'], []);
  assert.ok(first.files.some((row) => row.status === 'created'));
  const target = join(dir, '.opencode', 'plugins', 'agent-office', 'index.js');
  await writeFile(target, 'custom plugin\n');
  const second = await install(dir, ['--plugin', '--apply'], []);
  assert.ok(second.files.every((row) => row.status !== 'created'));
  assert.equal(await readFile(target, 'utf8'), 'custom plugin\n');
});

test('missing selected lead is reported without substitution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'office-lead-'));
  const agents = [{ id: 'build', mode: 'primary' }];
  const result = await install(dir, ['--templates'], agents, 'ghost');
  assert.equal(result.lead.selected, null);
  assert.deepEqual(result.lead.available, ['build']);
  assert.equal(result.missing, 'ghost');
});

test('nested symlink escape is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'office-nested-'));
  const elsewhere = await mkdtemp(join(tmpdir(), 'office-elsewhere-'));
  await mkdir(join(dir, '.opencode'), { recursive: true });
  await symlink(elsewhere, join(dir, '.opencode', 'agents'));
  await assert.rejects(install(dir, ['--apply', '--templates'], []), /symbolic link/);
  assert.deepEqual(await readdir(elsewhere), []);
});
