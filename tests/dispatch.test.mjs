import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { dispatch } from '../shared/dispatch.mjs';
import { saveSettings, settingsView } from '../shared/settings.mjs';

const LEAD = { id: 'lead', mode: 'primary' };
const MODELS = [
  { id: 'beam-free', modelID: 'beam-free', providerID: 'opencode-go', enabled: true, cost: [{ input: 0, output: 0 }] },
];

async function makeFixture(extraModels = []) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'office-dispatch-')));
  const state = await mkdtemp(join(tmpdir(), 'office-dispatch-state-'));
  process.env.AGENT_OFFICE_SETTINGS_FILE = join(state, 'settings.json');
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

function fakeRunner(fixture, calls) {
  return async (_command, args) => {
    const line = args.join(' ');
    calls.push(line);
    if (line.includes('/api/model/default')) return { stdout: JSON.stringify({ data: null }) };
    if (line.includes('/api/model')) return { stdout: JSON.stringify({ data: fixture.models }) };
    if (line.includes('/api/session/active')) return { stdout: JSON.stringify({ data: {} }) };
    if (args[1] === 'POST' && args[2] === '/api/session') {
      return { stdout: JSON.stringify({ data: { id: 'ses_test123' } }) };
    }
    if (line.includes('/prompt')) return { stdout: '{}' };
    if (args[1] === 'GET' && args[2]?.startsWith('/api/session/')) {
      return {
        stdout: JSON.stringify({
          data: { id: 'ses_test123', location: { directory: fixture.dir }, outcome: 'succeeded' },
        }),
      };
    }
    if (args[1] === 'GET' && args[2] === '/api/session') return { stdout: JSON.stringify({ data: [] }) };
    throw new Error(`Unexpected host call: ${line}`);
  };
}

async function cleanup(fixture) {
  delete process.env.AGENT_OFFICE_SETTINGS_FILE;
  delete process.env.XDG_STATE_HOME;
  await rm(fixture.dir, { recursive: true, force: true });
  await rm(fixture.state, { recursive: true, force: true });
}

async function configure(fixture, values) {
  await saveSettings(fixture.dir, 'project', {
    lead: 'lead',
    leadModel: 'opencode-go/beam-free',
    parallelism: 1,
    budget: 1,
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
    assert.equal(result.leadModel, 'opencode-go/beam-free');
    assert.equal(result.specialistModel, 'opencode-go/beam-free');
    assert.equal(result.directory, fixture.dir);
    assert.ok(calls.some((call) => call.includes('POST /api/session ')));
    assert.ok(calls.some((call) => call.includes('/api/session/ses_test123/prompt')));
  } finally {
    await cleanup(fixture);
  }
});

test('dispatch refuses unknown cost with a finite budget', async () => {
  const fixture = await makeFixture();
  try {
    await configure(fixture, { leadModel: 'p/unknown' });
    await assert.rejects(
      dispatch(fixture.dir, 'do work', {
        run: fakeRunner(fixture, []),
        inspectFn: () => fixture.inspectFn(),
      }),
      /leadModel|catalog/i,
    );
  } finally {
    await cleanup(fixture);
  }
});

test('zero budget with a free model remains valid', async () => {
  const fixture = await makeFixture();
  try {
    await configure(fixture, { budget: 0 });
    const result = await dispatch(fixture.dir, 'do work', {
      run: fakeRunner(fixture, []),
      inspectFn: () => fixture.inspectFn(),
    });
    assert.equal(result.sessionId, 'ses_test123');
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
