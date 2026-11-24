// Deterministic, always-running regressions for the Office steward projection.
// No browser, service, filesystem or network access: these test the pure
// source used by panel/main.ts, so they run in every `bun test` invocation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observation, modelAvailable, steward } from '../shared/steward.mjs';

const DIR = '/tmp/project-a';
const OTHER_DIR = '/tmp/project-b';

function session(id, parentId, opts = {}) {
  return {
    id,
    parentId: parentId ?? null,
    projectId: opts.projectId ?? 'p-a',
    directory: opts.directory ?? (opts.projectId === 'p-b' ? OTHER_DIR : DIR),
    agent: opts.agent ?? id,
    title: opts.title ?? id,
    archivedAt: opts.archivedAt ?? null,
    activity: opts.activity ?? 'idle',
    outcome: opts.outcome ?? null,
    unread: opts.unread === true,
  };
}

const AGENTS = [
  { id: 'lead', mode: 'primary', model: { providerID: 'opencode-go', id: 'beam-free' } },
  { id: 'helper', mode: 'primary' },
];
const MODELS = ['opencode-go/beam-free', 'opencode-go/glm-5-free'];
const ROOT_RESERVATION = { rootId: 'root-1', phase: 'finished', estimatedLeadCost: null };

function info(overrides = {}) {
  return {
    agents: AGENTS,
    models: MODELS,
    variants: {},
    settings: { lead: 'lead', leadModel: 'opencode-go/beam-free', specialistModel: 'opencode-go/glm-5-free' },
    sources: { lead: 'project', leadModel: 'project', specialistModel: 'project' },
    project: { lead: 'lead' },
    global: { lead: null },
    plugin: true,
    agentDiscovery: 'ready',
    modelDiscovery: 'ready',
    hostModel: { providerID: 'opencode-go', id: 'beam-free' },
    reservations: [ROOT_RESERVATION],
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    kind: 'sessions',
    state: 'ready',
    projectId: 'p-a',
    coverage: [{ directory: DIR, state: 'ready' }],
    sessions: [
      session('root-1', null, { title: 'Root', outcome: 'completed' }),
      session('child', 'root-1', { title: 'Child', activity: 'running' }),
    ],
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    directory: DIR,
    projectId: 'p-a',
    rootId: 'root-1',
    snapshot: snapshot(),
    inspect: info(),
    inspectState: 'ready',
    inspectError: '',
    snapshotError: '',
    ...overrides,
  };
}

// --- Session labels: observe only, never infer a reply --------------------

test('observation reports waiting and running activity without promising a reply', () => {
  assert.deepEqual(observation(session('x', null, { activity: 'waiting-question' })), { tone: 'waiting', label: 'Waiting for an answer' });
  assert.deepEqual(observation(session('x', null, { activity: 'waiting-permission' })), { tone: 'waiting', label: 'Waiting for permission' });
  assert.deepEqual(observation(session('x', null, { activity: 'running' })), { tone: 'running', label: 'Running' });
  assert.deepEqual(observation(session('x', null, { activity: 'retrying' })), { tone: 'running', label: 'Retrying' });
  // A recorded outcome must not overwrite an activity that is still running.
  assert.equal(observation(session('x', null, { activity: 'running', outcome: 'completed' })).label, 'Running');
});

test('observation reports idle, completion, failure and unread truthfully', () => {
  assert.deepEqual(observation(session('x', null)), { tone: 'idle', label: 'Idle' });
  assert.deepEqual(observation(session('x', null, { unread: true })), { tone: 'idle', label: 'Idle · unread activity' });
  assert.deepEqual(observation(session('x', null, { outcome: 'completed' })), { tone: 'completed', label: 'Completed · result not verified' });
  assert.deepEqual(observation(session('x', null, { outcome: 'failed' })), { tone: 'failed', label: 'Failed' });
  // Completion outranks unread but still never claims the result was verified.
  assert.equal(observation(session('x', null, { outcome: 'completed', unread: true })).label, 'Completed · result not verified');
  assert.deepEqual(observation(session('x', null, { activity: 'unknown' })), { tone: 'unknown', label: 'Status unknown' });
  assert.deepEqual(observation(session('x', null, { activity: 'something-new' })), { tone: 'unknown', label: 'Status unknown' });
});

test('no observation label claims a reply was sent or received', () => {
  for (const activity of ['idle', 'running', 'retrying', 'waiting-question', 'waiting-permission', 'unknown']) {
    for (const outcome of [null, 'completed', 'failed']) {
      for (const unread of [false, true]) {
        const { tone, label } = observation(session('x', null, { activity, outcome, unread }));
        assert.ok(typeof tone === 'string' && tone.length > 0);
        assert.doesNotMatch(label, /reply/i, `${activity}/${outcome}/${unread} -> ${label}`);
      }
    }
  }
});

// --- Model routing helpers ------------------------------------------------

test('modelAvailable validates exact model and variant routes', () => {
  const catalog = { models: MODELS, variants: { 'opencode-go/beam-free': ['fast', 'slow'] } };
  assert.equal(modelAvailable(catalog, 'opencode-go/beam-free'), true);
  assert.equal(modelAvailable(catalog, 'opencode-go/beam-free#fast'), true);
  assert.equal(modelAvailable(catalog, 'opencode-go/beam-free#missing'), false);
  assert.equal(modelAvailable(catalog, 'opencode-go/paid'), false);
  assert.equal(modelAvailable(catalog, 'opencode-go/beam-free#fast#extra'), false);
  assert.equal(modelAvailable(catalog, null), false);
  assert.equal(modelAvailable(catalog, undefined), false);
});

// --- Steward lifecycle ----------------------------------------------------

test('Ready: configured dashboard carries effective model, source and truthful records', () => {
  const h = steward(state());
  assert.equal(h.state, 'Ready');
  assert.match(h.reason, /session updates connected/);
  assert.equal(h.configured, true);
  assert.equal(h.model, 'opencode-go/beam-free');
  assert.equal(h.source, 'project');
  assert.deepEqual(h.records.map(r => [r.id, r.tone, r.label]), [
    ['root-1', 'completed', 'Completed · result not verified'],
    ['child', 'running', 'Running'],
  ]);
});

test('Setup required: no folder or no configured lead means onboarding', () => {
  const noDir = steward(state({ directory: null, inspect: null, inspectState: 'idle' }));
  assert.equal(noDir.state, 'Setup required');
  assert.equal(noDir.reason, 'Open a project folder.');
  assert.equal(noDir.configured, false);
  assert.deepEqual(noDir.records, []);

  const noLead = steward(state({ inspect: info({ settings: {}, sources: {} }) }));
  assert.equal(noLead.state, 'Setup required');
  assert.equal(noLead.reason, 'Preview the available agents and choose a lead.');
  assert.equal(noLead.configured, false);
});

test('Checking and Degraded keep a reason the user can act on', () => {
  const checking = steward(state({ inspectState: 'loading' }));
  assert.equal(checking.state, 'Checking');
  assert.match(checking.reason, /Reading project settings/);

  const inspectError = steward(state({ inspectState: 'error', inspectError: 'Service stopped.' }));
  assert.equal(inspectError.state, 'Degraded');
  assert.equal(inspectError.reason, 'Service stopped.');

  const discovery = steward(state({ inspect: info({ agentDiscovery: 'unavailable' }) }));
  assert.equal(discovery.state, 'Degraded');
  assert.match(discovery.reason, /discovery is unavailable/);

  const coverage = steward(state({ snapshot: snapshot({ coverage: [] }) }));
  assert.equal(coverage.state, 'Degraded');
  assert.match(coverage.reason, /coverage is unavailable/);

  const records = steward(state({ inspect: info({ reservations: undefined }) }));
  assert.equal(records.state, 'Degraded');
  assert.match(records.reason, /records were not confirmed/);
});

test('Needs attention: lead, model, specialist and dispatch blockers', () => {
  const badLead = steward(state({ inspect: info({ settings: { lead: 'ghost', leadModel: 'opencode-go/beam-free' } }) }));
  assert.equal(badLead.state, 'Needs attention');
  assert.match(badLead.reason, /ghost/);

  const badModel = steward(state({ inspect: info({ settings: { lead: 'lead', leadModel: 'opencode-go/paid' } }) }));
  assert.equal(badModel.state, 'Needs attention');
  assert.match(badModel.reason, /model or variant is unavailable/);

  const badVariant = steward(state({
    inspect: info({
      settings: { lead: 'lead', leadModel: 'opencode-go/beam-free#fast' },
      variants: { 'opencode-go/beam-free': ['slow'] },
    }),
  }));
  assert.equal(badVariant.state, 'Needs attention');

  const goodVariant = steward(state({
    inspect: info({
      settings: { lead: 'lead', leadModel: 'opencode-go/beam-free#fast' },
      variants: { 'opencode-go/beam-free': ['fast'] },
    }),
  }));
  assert.equal(goodVariant.state, 'Ready');

  const badSpecialist = steward(state({ inspect: info({ settings: { lead: 'lead', specialistModel: 'opencode-go/paid' } }) }));
  assert.equal(badSpecialist.state, 'Needs attention');
  assert.match(badSpecialist.reason, /specialist preference/);

  const budget = steward(state({ inspect: info({ settings: { lead: 'lead', leadModel: 'opencode-go/beam-free', budget: 5 } }) }));
  assert.equal(budget.state, 'Needs attention');
  assert.match(budget.reason, /finite budget/);

  const paused = steward(state({ inspect: info({ settings: { lead: 'lead', leadModel: 'opencode-go/beam-free', parallelism: 0 } }) }));
  assert.equal(paused.state, 'Needs attention');
  assert.match(paused.reason, /parallelism is zero/);
});

test('Needs attention: pending reservations and highlighted records', () => {
  const pending = steward(state({ inspect: info({ reservations: [{ rootId: 'root-1', phase: 'sending' }] }) }));
  assert.equal(pending.state, 'Needs attention');
  assert.match(pending.reason, /pending or uncertain/);

  const missing = steward(state({ inspect: info({ reservations: [{ rootId: 'ghost', phase: 'open' }] }) }));
  assert.equal(missing.state, 'Needs attention');
  assert.match(missing.reason, /reserved root is not visible/);

  const waiting = steward(state({ snapshot: snapshot({ sessions: [
    session('root-1', null, { activity: 'waiting-question' }),
    session('child', 'root-1'),
  ] }) }));
  assert.equal(waiting.state, 'Needs attention');
  assert.match(waiting.reason, /highlighted session/);

  const failed = steward(state({ snapshot: snapshot({ sessions: [
    session('root-1', null, { outcome: 'failed' }),
    session('child', 'root-1'),
  ] }) }));
  assert.equal(failed.state, 'Needs attention');
});

// --- Project and root isolation -------------------------------------------

test('records isolate families by root and exclude other projects/directories', () => {
  const snap = snapshot({ sessions: [
    session('root-a', null, { title: 'A' }),
    session('child-a', 'root-a', { title: 'A child' }),
    session('root-b', null, { title: 'B' }),
    session('child-b', 'root-b', { title: 'B child' }),
    session('foreign', 'root-a', { projectId: 'p-b' }),
    session('other-dir', 'root-a', { directory: OTHER_DIR }),
    session('archived', 'root-a', { archivedAt: 1 }),
  ] });
  const twoRoots = info({ reservations: [
    { rootId: 'root-a', phase: 'finished' },
    { rootId: 'root-b', phase: 'finished' },
  ] });
  const ids = (rootId) => steward(state({ snapshot: snap, inspect: twoRoots, rootId })).records.map(r => r.id);
  assert.deepEqual(ids('root-a'), ['root-a', 'child-a']);
  assert.deepEqual(ids('child-b'), ['root-b', 'child-b']);
  assert.deepEqual(ids(null), ['root-a', 'child-a', 'root-b', 'child-b']);
});

test('from an ordinary chat the dashboard shows project Office work, never that chat', () => {
  const snap = snapshot({ sessions: [session('root-1', null)] });
  const h = steward(state({ snapshot: snap, rootId: null }));
  assert.deepEqual(h.records.map(r => r.id), ['root-1']);
  assert.equal(h.state, 'Ready');
});

// --- Effective model and source -------------------------------------------

test('effective model/source resolves leadModel, then agent binding, then host', () => {
  assert.deepEqual(
    [steward(state()).model, steward(state()).source],
    ['opencode-go/beam-free', 'project'],
  );

  const agentBound = steward(state({ inspect: info({ settings: { lead: 'lead' }, sources: { lead: 'project' } }) }));
  assert.equal(agentBound.model, 'opencode-go/beam-free');
  assert.equal(agentBound.source, 'agent');

  const host = steward(state({ inspect: info({
    agents: [{ id: 'lead', mode: 'primary' }],
    settings: { lead: 'lead' },
    sources: { lead: 'project' },
  }) }));
  assert.equal(host.model, 'opencode-go/beam-free');
  assert.equal(host.source, 'host');
  assert.equal(host.state, 'Ready');

  const unknown = steward(state({ inspect: info({ sources: {} }) }));
  assert.equal(unknown.source, 'unknown');
});

test('a missing model is reported, never invented', () => {
  const missing = steward(state({ inspect: info({
    agents: [{ id: 'lead', mode: 'primary' }],
    settings: { lead: 'lead' },
    sources: { lead: 'project' },
    hostModel: null,
  }) }));
  assert.equal(missing.model, null);
  assert.equal(missing.source, 'host');
  assert.equal(missing.state, 'Needs attention');
  assert.match(missing.reason, /model or variant is unavailable/);

  // A "default" variant is not a real variant in a route.
  const defaultVariant = steward(state({ inspect: info({
    agents: [{ id: 'lead', mode: 'primary', model: { providerID: 'opencode-go', id: 'beam-free', variant: 'default' } }],
    settings: { lead: 'lead' },
    sources: { lead: 'project' },
  }) }));
  assert.equal(defaultVariant.model, 'opencode-go/beam-free');
  assert.equal(defaultVariant.source, 'agent');
});

// --- One scoped family for both surfaces; trusted snapshots only -----------

test('status records and the Office grid family always expose the same ids', () => {
  const variants = [
    state(),
    state({ rootId: 'child' }),
    state({ rootId: null }),
    state({ rootId: 'outsider', snapshot: snapshot({ sessions: [
      session('root-1', null), session('child', 'root-1'),
      session('outsider', null), session('outsider-child', 'outsider'),
    ] }) }),
    state({ inspect: info({ settings: {}, sources: {} }) }),
    state({ inspectState: 'error', inspectError: 'Service stopped.' }),
    state({ snapshot: snapshot({ coverage: [] }) }),
    state({ projectId: null }),
    state({ snapshot: snapshot({ projectId: 'p-b' }) }),
    state({ snapshot: { kind: 'sessions', state: 'ready', sessions: [session('root-1', null)] } }),
  ];
  for (const s of variants) {
    const h = steward(s);
    assert.deepEqual(h.records.map(r => r.id), h.family.map(x => x.id), h.state);
  }
});

test('a descendant sees its whole family; an unrelated chat sees only confirmed teams', () => {
  const snap = snapshot({ sessions: [
    session('root-a', null), session('child-a', 'root-a'), session('grand-a', 'child-a'),
    session('root-b', null), session('child-b', 'root-b'),
    session('outsider', null), session('outsider-child', 'outsider'),
  ] });
  const two = info({ reservations: [
    { rootId: 'root-a', phase: 'finished' },
    { rootId: 'root-b', phase: 'finished' },
  ] });
  const ids = (rootId) => steward(state({ snapshot: snap, inspect: two, rootId })).family.map(s => s.id);
  assert.deepEqual(ids('root-a'), ['root-a', 'child-a', 'grand-a']);
  assert.deepEqual(ids('grand-a'), ['root-a', 'child-a', 'grand-a']);
  assert.deepEqual(ids('child-b'), ['root-b', 'child-b']);
  assert.deepEqual(ids('outsider'), ['root-a', 'child-a', 'grand-a', 'root-b', 'child-b']);
  assert.deepEqual(ids('outsider-child'), ['root-a', 'child-a', 'grand-a', 'root-b', 'child-b']);
});

test('missing project id, foreign snapshot or unready coverage cannot be Ready or expose records', () => {
  const snap = snapshot();
  const cases = [
    state({ projectId: null }),
    state({ snapshot: { ...snap, projectId: undefined } }),
    state({ snapshot: { ...snap, projectId: 'p-b' } }),
    state({ snapshot: { ...snap, coverage: undefined } }),
    state({ snapshot: { ...snap, coverage: {} } }),
    state({ snapshot: { ...snap, coverage: [] } }),
    state({ snapshot: { ...snap, coverage: [{ directory: DIR, state: 'loading' }] } }),
    state({ snapshot: { ...snap, coverage: [{ directory: OTHER_DIR, state: 'ready' }] } }),
    state({ snapshot: { ...snap, state: 'loading' } }),
    state({ snapshotError: 'OpenChamber could not read the session list.' }),
  ];
  for (const s of cases) {
    const h = steward(s);
    assert.equal(h.state, 'Degraded', h.reason);
    assert.deepEqual(h.family, []);
    assert.deepEqual(h.records, []);
  }
});

// --- Reserved root visibility: membership, not record order ----------------

test('a visible reserved root is ready in child-first and root-first snapshots', () => {
  const rootFirst = [
    session('root-1', null, { title: 'Root', outcome: 'completed' }),
    session('child', 'root-1', { title: 'Child', activity: 'running' }),
  ];
  const childFirst = [...rootFirst].reverse();
  const ordered = (rows) => steward(state({ snapshot: snapshot({ sessions: rows }) }));
  const a = ordered(rootFirst);
  const b = ordered(childFirst);
  assert.equal(a.state, 'Ready');
  assert.equal(b.state, 'Ready');
  assert.doesNotMatch(b.reason, /reserved root is not visible/);
  const ids = (h) => h.records.map(r => r.id).sort();
  assert.deepEqual(ids(b), ids(a));
  assert.deepEqual(b.family.map(s => s.id).sort(), a.family.map(s => s.id).sort());
});

test('an absent reserved root still needs attention in any record order', () => {
  const rows = [
    session('child', 'root-1'),
    session('unrelated', null),
  ];
  for (const sessions of [rows, [...rows].reverse()]) {
    const h = steward(state({
      snapshot: snapshot({ sessions }),
      inspect: info({ reservations: [{ rootId: 'root-1', phase: 'open' }] }),
    }));
    assert.equal(h.state, 'Needs attention');
    assert.match(h.reason, /reserved root is not visible/);
  }
});

test('child-first ordering does not bypass the snapshot trust gate', () => {
  const snap = snapshot({ sessions: [
    session('child', 'root-1'),
    session('root-1', null),
  ], coverage: [] });
  const h = steward(state({ snapshot: snap }));
  assert.equal(h.state, 'Degraded');
  assert.deepEqual(h.family, []);
  assert.deepEqual(h.records, []);
});
