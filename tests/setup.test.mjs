import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectLead } from '../shared/setup.mjs';

const READY = 'ready';
const CHOOSE = 'choose-lead';
const NONE = 'no-candidates';

test('selectLead: no candidates when agents empty', () => {
  assert.deepEqual(selectLead([], null), { selected: null, available: [], nextAction: NONE });
  assert.deepEqual(selectLead([], 'ghost'), { selected: null, available: [], nextAction: NONE });
  assert.deepEqual(selectLead(null, null), { selected: null, available: [], nextAction: NONE });
  assert.deepEqual(selectLead(undefined, undefined), { selected: null, available: [], nextAction: NONE });
});

test('selectLead: absent lead with candidates asks to choose', () => {
  const agents = [{ id: 'alpha', mode: 'primary' }];
  assert.deepEqual(selectLead(agents, null), { selected: null, available: ['alpha'], nextAction: CHOOSE });
  assert.deepEqual(selectLead(agents, undefined), { selected: null, available: ['alpha'], nextAction: CHOOSE });
  assert.deepEqual(selectLead(agents, ''), { selected: null, available: ['alpha'], nextAction: CHOOSE });
});

test('selectLead: absent (unknown) lead is not substituted', () => {
  const agents = [
    { id: 'alpha', mode: 'primary' },
    { id: 'beta', mode: 'all' },
  ];
  const r = selectLead(agents, 'ghost');
  assert.equal(r.selected, null);
  assert.deepEqual(r.available, ['alpha', 'beta']);
  assert.equal(r.nextAction, CHOOSE);
});

test('selectLead: actual selected lead that is available is honoured (ready)', () => {
  const agents = [
    { id: 'alpha', mode: 'primary' },
    { id: 'beta', mode: 'all' },
  ];
  assert.deepEqual(selectLead(agents, 'alpha'), { selected: 'alpha', available: ['alpha', 'beta'], nextAction: READY });
  assert.deepEqual(selectLead(agents, 'beta'), { selected: 'beta', available: ['alpha', 'beta'], nextAction: READY });
});

test('selectLead: trims requested id', () => {
  const agents = [{ id: 'alpha', mode: 'primary' }];
  assert.equal(selectLead(agents, '  alpha  ').selected, 'alpha');
  assert.equal(selectLead(agents, '  alpha  ').nextAction, READY);
});

test('selectLead: filters hidden agents out of available', () => {
  const agents = [
    { id: 'hidden-one', mode: 'primary', hidden: true },
    { id: 'visible', mode: 'primary' },
  ];
  const r = selectLead(agents, null);
  assert.deepEqual(r.available, ['visible']);
  assert.equal(r.nextAction, CHOOSE);
  // a hidden requested lead is not honoured
  const r2 = selectLead(agents, 'hidden-one');
  assert.equal(r2.selected, null);
  assert.deepEqual(r2.available, ['visible']);
});

test('selectLead: filters subagent-mode agents out of available', () => {
  const agents = [
    { id: 'sub', mode: 'subagent' },
    { id: 'helper', mode: 'subagent' },
    { id: 'lead', mode: 'primary' },
  ];
  const r = selectLead(agents, null);
  assert.deepEqual(r.available, ['lead']);
  assert.equal(r.nextAction, CHOOSE);
  const r2 = selectLead(agents, 'sub');
  assert.equal(r2.selected, null);
  assert.deepEqual(r2.available, ['lead']);
});

test('selectLead: filters subagent-flagged agents even with primary mode', () => {
  const agents = [
    { id: 'flagged', mode: 'primary', subagent: true },
    { id: 'flagged2', mode: 'primary', subagentOnly: true },
    { id: 'lead', mode: 'primary' },
  ];
  const r = selectLead(agents, null);
  assert.deepEqual(r.available, ['lead']);
});

test('selectLead: hidden flag only true filters (false/absent allowed)', () => {
  const agents = [
    { id: 'a', mode: 'primary', hidden: false },
    { id: 'b', mode: 'primary' },
    { id: 'c', mode: 'primary', hidden: 'yes' },
  ];
  const r = selectLead(agents, null);
  // hidden === true only; string 'yes' is not strict true
  assert.deepEqual(r.available, ['a', 'b', 'c']);
});

test('selectLead: existing custom lead with mode "all" is a candidate and selectable', () => {
  const agents = [{ id: 'custom-lead', mode: 'all' }];
  assert.deepEqual(selectLead(agents, 'custom-lead'), {
    selected: 'custom-lead',
    available: ['custom-lead'],
    nextAction: READY,
  });
});

test('selectLead: allowed primary modes (primary/all/undefined/null/empty)', () => {
  const agents = [
    { id: 'p', mode: 'primary' },
    { id: 'a', mode: 'all' },
    { id: 'u', mode: undefined },
    { id: 'n', mode: null },
    { id: 'e', mode: '' },
  ];
  const r = selectLead(agents, null);
  assert.deepEqual(r.available, ['p', 'a', 'u', 'n', 'e']);
  assert.equal(r.nextAction, CHOOSE);
});

test('selectLead: disallowed/unknown modes are filtered', () => {
  const agents = [
    { id: 'x', mode: 'secondary' },
    { id: 'y', mode: 'background' },
    { id: 'z', mode: 42 },
  ];
  const r = selectLead(agents, null);
  assert.deepEqual(r.available, []);
  assert.equal(r.nextAction, NONE);
});

test('selectLead: no candidates when all filtered out, even if selected known', () => {
  const agents = [{ id: 'hidden', mode: 'primary', hidden: true }];
  const r = selectLead(agents, 'hidden');
  assert.equal(r.selected, null);
  assert.deepEqual(r.available, []);
  assert.equal(r.nextAction, NONE);
});

test('selectLead: does not mutate input agents', () => {
  const agents = [{ id: 'alpha', mode: 'primary' }];
  const snapshot = JSON.stringify(agents);
  selectLead(agents, 'alpha');
  selectLead(agents, 'ghost');
  assert.equal(JSON.stringify(agents), snapshot);
});

test('selectLead: dedups duplicate ids, first wins', () => {
  const agents = [
    { id: 'dup', mode: 'primary' },
    { id: 'dup', mode: 'subagent' },
  ];
  const r = selectLead(agents, null);
  assert.deepEqual(r.available, ['dup']);
});

test('selectLead: agent records may omit id? uses object identity no - id required', () => {
  // records without usable id are dropped
  const agents = [{ mode: 'primary' }, { id: '', mode: 'primary' }];
  const r = selectLead(agents, null);
  assert.deepEqual(r.available, []);
  assert.equal(r.nextAction, NONE);
});

test('selectLead: result shape keys exactly', () => {
  const r = selectLead([{ id: 'a', mode: 'primary' }], 'a');
  assert.deepEqual(Object.keys(r).sort(), ['available', 'nextAction', 'selected']);
  assert.equal(typeof r.selected === 'string' || r.selected === null, true);
  assert.ok(Array.isArray(r.available));
  assert.equal(typeof r.nextAction, 'string');
});

test('selectLead: accepts id-keyed map of agent records', () => {
  const agents = {
    alpha: { mode: 'primary' },
    beta: { mode: 'all', hidden: true },
  };
  const r = selectLead(agents, 'alpha');
  assert.equal(r.selected, 'alpha');
  assert.deepEqual(r.available, ['alpha']);
  assert.equal(r.nextAction, READY);
});
