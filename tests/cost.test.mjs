import { test } from 'node:test';
import assert from 'node:assert/strict';

import cost, { calculateCost } from '../shared/cost.mjs';

test('cost deduplicates step ids', () => {
  const steps = [
    { id: 'a', cost: 5 },
    { id: 'a', cost: 7 },
    { id: 'b', cost: 3 },
  ];
  const result = cost(steps);
  assert.equal(result.original, 3);
  assert.equal(result.deduplicated, 2);
  assert.equal(result.total, 8);
});

test('cost distinguishes reported and unknown', () => {
  const steps = [
    { id: 'r', reportedCost: 4 },
    { id: 'u' },
  ];
  const result = cost(steps);
  assert.equal(result.reported, 4);
  assert.equal(result.unknown, 0);
  assert.equal(result.counts.unknown, 1);
});

test('cost estimates from host catalog', () => {
  const steps = [{ id: 'e', model: 'm', inputTokens: 1000000, outputTokens: 1000000 }];
  const catalog = { m: { input: 1, output: 2 } };
  const result = cost({ steps, catalog });
  assert.equal(result.estimated, 3);
});

test('cost marks synthetic', () => {
  const steps = [{ id: 's', synthetic: true, cost: 99 }];
  const result = calculateCost(steps);
  assert.equal(result['test-synthetic'], 0);
  assert.equal(result.counts['test-synthetic'], 1);
});

test('cost dedups parent child replay by child preference', () => {
  const steps = [
    { id: 'x', cost: 10, parentId: null },
    { id: 'x', cost: 2, child: true },
  ];
  const result = cost(steps);
  assert.equal(result.total, 2);
});