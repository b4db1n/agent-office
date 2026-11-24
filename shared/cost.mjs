/**
 * Agent Office — pure, read-only cost accounting helpers.
 *
 * Classification rules (no I/O in this module):
 *  - A finite, non-negative *reported* cost is authoritative even when it is 0.
 *    Observed zero is never rewritten as "unknown" or as a free guess.
 *  - An estimate is produced only when BOTH token counts and BOTH rates are
 *    present and valid. Missing, NaN, Infinity, empty or non-numeric values
 *    make the step "unknown" — never an implicit 0.
 *  - Duplicates are removed by stable event identifier; a replay coming from a
 *    child session wins over the parent copy of the same event.
 */

export const SOURCE = Object.freeze({
  REPORTED: 'reported',
  ESTIMATED: 'estimated',
  HOST_CATALOG: 'host-catalog',
  UNKNOWN: 'unknown',
  TEST_SYNTHETIC: 'test-synthetic',
});

const ID_KEYS = Object.freeze([
  'id', 'stepId', 'stepID', 'eventId', 'eventID',
  'partId', 'partID', 'messageId', 'messageID', 'key',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeInput(input, catalog) {
  let steps = [];
  let hostCatalog = catalog;
  if (Array.isArray(input)) {
    steps = input;
  } else if (isObject(input)) {
    steps = input.steps ?? input.items ?? input.records ?? input.entries ?? [];
    hostCatalog = input.catalog ?? input.hostCatalog ?? input.models ?? input.pricing ?? catalog;
  }
  if (!Array.isArray(steps)) steps = [];
  return { steps, hostCatalog: isObject(hostCatalog) ? hostCatalog : {} };
}

// Accept finite numbers (and clean numeric strings) only; 0 is a valid value.
function finiteNonNegative(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function firstValue(step, keys) {
  for (const key of keys) {
    if (isObject(step) && Object.prototype.hasOwnProperty.call(step, key)) {
      const value = step[key];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

function stepId(step) {
  if (!isObject(step)) return null;
  for (const key of ID_KEYS) {
    const value = step[key];
    if (typeof value === 'string' || typeof value === 'number') {
      if (String(value).length > 0) return String(value);
    }
  }
  return null;
}

function isSynthetic(step) {
  if (!isObject(step)) return false;
  if (step.synthetic === true || step.test === true || step.testSynthetic === true) return true;
  const source = String(step.source ?? step.kind ?? step.type ?? '').toLowerCase();
  return source.includes('synthetic') || source.includes('test');
}

function reportedCost(step) {
  if (!isObject(step)) return null;
  for (const key of ['reportedCost', 'cost', 'actualCost', 'price']) {
    const value = finiteNonNegative(step[key]);
    if (value !== null) return value;
  }
  if (isObject(step.usage)) {
    const value = finiteNonNegative(step.usage.cost);
    if (value !== null) return value;
  }
  return null;
}

function estimateFromCatalog(step, catalog) {
  if (!isObject(step) || !isObject(catalog)) return null;
  const model = firstValue(step, ['model', 'modelId', 'modelID']);
  if (model === undefined) return null;
  const modelKey = String(model);
  const provider = firstValue(step, ['provider', 'providerID', 'providerId']);
  const providerKey = provider === undefined ? null : `${provider}/${modelKey}`;
  const entry = providerKey ? catalog[providerKey] : catalog[modelKey];
  if (!isObject(entry)) return null;

  // OpenCode v2.3.2 exposes `cost` as an array of tier entries; v1 and flat
  // fixtures use an object. Use the untiered/base entry when present, never a
  // guessed tier. Values are per 1,000,000 tokens.
  let rates = entry;
  if (Array.isArray(entry.cost)) {
    rates = entry.cost.find((tier) => isObject(tier) && tier.tier === undefined) ?? null;
  } else if (isObject(entry.cost)) {
    rates = entry.cost;
  }
  if (!isObject(rates)) return null;
  const inputRate = finiteNonNegative(firstValue(rates, ['input', 'inputCost', 'prompt']));
  const outputRate = finiteNonNegative(firstValue(rates, ['output', 'outputCost', 'completion']));
  if (inputRate === null || outputRate === null) return null;

  const tokenBag = isObject(step.tokens) ? step.tokens : null;
  const usageBag = isObject(step.usage) ? step.usage : null;
  const inputTokens = finiteNonNegative(
    firstValue(step, ['inputTokens']) ?? firstValue(tokenBag ?? {}, ['input']) ?? firstValue(usageBag ?? {}, ['inputTokens', 'input']),
  );
  const outputTokens = finiteNonNegative(
    firstValue(step, ['outputTokens']) ?? firstValue(tokenBag ?? {}, ['output']) ?? firstValue(usageBag ?? {}, ['outputTokens', 'output']),
  );
  if (inputTokens === null || outputTokens === null) return null;
  // Host token normalizers substitute 0 for absent/invalid components. With no
  // positive token count there is no evidence of billable usage to estimate.
  if (inputTokens === 0 && outputTokens === 0) return null;

  let extra = 0;
  for (const key of ['read','write']) {
    const count = finiteNonNegative(tokenBag?.cache?.[key] ?? 0);
    const rate = finiteNonNegative(rates.cache?.[key]);
    if (count === null || (count > 0 && rate === null)) return null;
    extra += count * (rate ?? 0);
  }
  const reasoning = finiteNonNegative(tokenBag?.reasoning ?? 0);
  if (reasoning === null) return null;
  return (inputTokens * inputRate + (outputTokens + reasoning) * outputRate + extra) / 1_000_000;
}

/**
 * Classify one usage step. Returns { source, cost }; `cost` is 0 for unknown
 * and synthetic steps so an unpriced event can never inflate the total.
 */
export function classifyCost(step, catalog = {}) {
  if (isSynthetic(step)) return { source: SOURCE.TEST_SYNTHETIC, cost: 0 };
  const reported = reportedCost(step);
  if (reported !== null) return { source: SOURCE.REPORTED, cost: reported };
  const estimated = estimateFromCatalog(step, catalog);
  if (estimated !== null) return { source: SOURCE.ESTIMATED, cost: estimated };
  return { source: SOURCE.UNKNOWN, cost: 0 };
}

function deduplicateSteps(steps) {
  const byId = new Map();
  const anonymous = [];
  for (const step of steps) {
    const id = stepId(step);
    if (id === null) {
      anonymous.push(step);
      continue;
    }
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, step);
      continue;
    }
    const existingIsChild = Boolean(existing.parentId || existing.parentID || existing.child === true);
    const candidateIsChild = Boolean(step.parentId || step.parentID || step.child === true);
    if (candidateIsChild && !existingIsChild) byId.set(id, step);
  }
  return [...byId.values(), ...anonymous];
}

export function cost(input, catalog) {
  const { steps, hostCatalog } = normalizeInput(input, catalog);
  const deduped = deduplicateSteps(steps);

  const buckets = {
    reported: 0,
    estimated: 0,
    'host-catalog': 0,
    unknown: 0,
    'test-synthetic': 0,
  };
  const counts = {
    reported: 0,
    estimated: 0,
    'host-catalog': 0,
    unknown: 0,
    'test-synthetic': 0,
  };
  const details = [];

  for (const step of deduped) {
    const { source, cost: value } = classifyCost(step, hostCatalog);
    // `estimated` and `host-catalog` are two names for the same catalog path.
    const label = source === SOURCE.ESTIMATED ? SOURCE.HOST_CATALOG : source;
    buckets[label] = (buckets[label] || 0) + value;
    counts[label] = (counts[label] || 0) + 1;
    if (label === SOURCE.HOST_CATALOG) {
      buckets.estimated += value;
      counts.estimated += 1;
    }
    details.push({ ...step, costSource: label, cost: value });
  }

  const total = buckets.reported + buckets.estimated;

  return {
    total,
    reported: buckets.reported,
    estimated: buckets.estimated,
    'host-catalog': buckets['host-catalog'],
    unknown: buckets.unknown,
    'test-synthetic': buckets['test-synthetic'],
    synthetic: buckets['test-synthetic'],
    counts,
    steps: details,
    deduplicated: deduped.length,
    original: steps.length,
  };
}

export const calculateCost = cost;
export const summarizeCost = cost;
export const estimateCost = cost;
export const costReport = cost;
export const inspectCost = cost;

export default cost;
