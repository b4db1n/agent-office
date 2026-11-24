import { test } from 'node:test';
import assert from 'node:assert/strict';

import cost, { calculateCost, classifyCost } from '../shared/cost.mjs';

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
  assert.equal(result.total, 3);
  assert.equal(result.counts.estimated, 1);
  assert.equal(result.counts['host-catalog'], 1);
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

test('observed reported zero is preserved, not turned into unknown', () => {
  const result = cost([
    { id: 'subscription', cost: 0 },
    { id: 'coupon', reportedCost: 0 },
    { id: 'nested', usage: { cost: 0 } },
  ]);
  assert.equal(result.reported, 0);
  assert.equal(result.total, 0);
  assert.equal(result.counts.reported, 3);
  assert.equal(result.counts.unknown, 0);
  assert.deepEqual(
    result.steps.map((step) => step.costSource),
    ['reported', 'reported', 'reported'],
  );
});

test('missing or incomplete rates and token counts are unknown, never estimated zero', () => {
  const catalog = { priced: { input: 1, output: 2 }, half: { input: 1 } };
  const steps = [
    { id: 'no-rate', model: 'absent', inputTokens: 10, outputTokens: 10 },
    { id: 'half-rate', model: 'half', inputTokens: 10, outputTokens: 10 },
    { id: 'no-output', model: 'priced', inputTokens: 10 },
    { id: 'no-input', model: 'priced', outputTokens: 10 },
    { id: 'no-tokens', model: 'priced' },
  ];
  const result = cost(steps, catalog);
  assert.equal(result.estimated, 0);
  assert.equal(result.total, 0);
  assert.equal(result.counts.unknown, 5);
  assert.equal(result.counts.estimated, 0);
});

test('invalid rates and token counts are unknown, not coerced to zero', () => {
  const catalog = {
    good: { input: 1, output: 2 },
    nan: { input: Number.NaN, output: 2 },
    inf: { input: 1, output: Number.POSITIVE_INFINITY },
    negative: { input: -1, output: 2 },
    blank: { input: '', output: 2 },
  };
  const steps = [
    { id: 'nan-rate', model: 'nan', inputTokens: 1, outputTokens: 1 },
    { id: 'inf-rate', model: 'inf', inputTokens: 1, outputTokens: 1 },
    { id: 'negative-rate', model: 'negative', inputTokens: 1, outputTokens: 1 },
    { id: 'blank-rate', model: 'blank', inputTokens: 1, outputTokens: 1 },
    { id: 'nan-tokens', model: 'good', inputTokens: Number.NaN, outputTokens: 1 },
    { id: 'negative-tokens', model: 'good', inputTokens: -1, outputTokens: 1 },
    { id: 'blank-tokens', model: 'good', inputTokens: '', outputTokens: 1 },
  ];
  const result = cost(steps, catalog);
  assert.equal(result.counts.unknown, 7);
  assert.equal(result.estimated, 0);
});

test('free catalog rate with valid tokens stays an observed estimate of zero', () => {
  const result = cost(
    [{ id: 'free-model', model: 'free', inputTokens: 10, outputTokens: 10 }],
    { free: { input: 0, output: 0 } },
  );
  assert.equal(result.estimated, 0);
  assert.equal(result.counts.estimated, 1);
  assert.equal(result.counts.unknown, 0);
});

test('OpenCode nested catalog shape and provider-qualified models are supported', () => {
  const catalog = { 'opencode-go/beam-free': { cost: { input: 1, output: 2 } } };
  const result = cost(
    [{ id: 'nested', modelID: 'beam-free', providerID: 'opencode-go', tokens: { input: 1000000, output: 1000000 } }],
    catalog,
  );
  assert.equal(result.estimated, 3);
});

test('dedup uses stable event identifiers across alias fields', () => {
  const result = cost([
    { id: 'prt_123', cost: 1 },
    { partId: 'prt_123', cost: 1 },
    { key: 'prt_123', cost: 1 },
  ]);
  assert.equal(result.deduplicated, 1);
  assert.equal(result.total, 1);
});

test('v2 cost-array catalog uses the untiered base entry', () => {
  const catalog = {
    'opencode-go/fast': {
      id: 'fast', modelID: 'base', providerID: 'opencode-go',
      cost: [
        { tier: { type: 'context', size: 1000 }, input: 9, output: 9 },
        { input: 1, output: 2 },
      ],
    },
  };
  const result = cost(
    [{ id: 'v2', model: 'fast', provider: 'opencode-go', inputTokens: 1000000, outputTokens: 1000000 }],
    catalog,
  );
  assert.equal(result.estimated, 3);
  assert.equal(result.counts.unknown, 0);
});

test('all-zero token counts are unknown, not a free estimate', () => {
  const result = cost(
    [{ id: 'zero', model: 'm', inputTokens: 0, outputTokens: 0 }],
    { m: { cost: [{ input: 1, output: 2 }] } },
  );
  assert.equal(result.counts.unknown, 1);
  assert.equal(result.estimated, 0);
});

test('classifyCost is pure and reports observed zero', () => {
  assert.deepEqual(classifyCost({ id: 'z', cost: 0 }), { source: 'reported', cost: 0 });
  assert.deepEqual(classifyCost({ id: 'u' }), { source: 'unknown', cost: 0 });
  assert.deepEqual(classifyCost({ id: 's', synthetic: true, cost: 9 }), { source: 'test-synthetic', cost: 0 });
});
