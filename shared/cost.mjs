/**
 * Agent Office — cost accounting helpers.
 */

const SOURCE = {
  REPORTED: 'reported',
  ESTIMATED: 'estimated',
  HOST_CATALOG: 'host-catalog',
  UNKNOWN: 'unknown',
  TEST_SYNTHETIC: 'test-synthetic',
};

function normalizeInput(input, catalog) {
  let steps = [];
  let hostCatalog = catalog;
  if (Array.isArray(input)) {
    steps = input;
  } else if (input && typeof input === 'object') {
    steps = input.steps ?? input.items ?? input.records ?? input.entries ?? [];
    hostCatalog = input.catalog ?? input.hostCatalog ?? input.models ?? input.pricing ?? catalog;
  }
  if (!Array.isArray(steps)) steps = [];
  return { steps, hostCatalog: hostCatalog && typeof hostCatalog === 'object' ? hostCatalog : {} };
}

function stepId(step) {
  if (!step || typeof step !== 'object') return null;
  const id = step.id ?? step.stepId ?? step.stepID ?? step.key;
  return id == null ? null : String(id);
}

function isSynthetic(step) {
  if (!step || typeof step !== 'object') return false;
  if (step.synthetic === true || step.test === true || step.testSynthetic === true) return true;
  const source = String(step.source ?? step.kind ?? step.type ?? '').toLowerCase();
  return source.includes('synthetic') || source.includes('test');
}

function reportedCost(step) {
  const value = step.reportedCost ?? step.cost ?? step.actualCost ?? step.price;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (step.usage && typeof step.usage.cost === 'number') return step.usage.cost;
  return null;
}

function estimateFromCatalog(step, catalog) {
  const model = step.model ?? step.modelId ?? step.modelID;
  if (!model) return null;
  const entry = catalog[model] ?? catalog[`${step.provider ?? ''}/${model}`.replace(/^\//, '')];
  if (!entry) return null;
  const inputTokens = Number(step.inputTokens ?? step.tokens?.input ?? step.usage?.inputTokens ?? 0);
  const outputTokens = Number(step.outputTokens ?? step.tokens?.output ?? step.usage?.outputTokens ?? 0);
  const inputRate = Number(entry.input ?? entry.inputCost ?? entry.prompt ?? 0);
  const outputRate = Number(entry.output ?? entry.outputCost ?? entry.completion ?? 0);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1000000;
}

function classify(step, catalog) {
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
    const existingIsChild = existing && (existing.parentId || existing.parentID || existing.child === true);
    const candidateIsChild = step && (step.parentId || step.parentID || step.child === true);
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
    const { source, cost: value } = classify(step, hostCatalog);
    let label = source;
    if (source === SOURCE.ESTIMATED) label = SOURCE.HOST_CATALOG;
    buckets[label] = (buckets[label] || 0) + value;
    counts[label] = (counts[label] || 0) + 1;
    details.push({ ...step, costSource: label, cost: value });
  }

  const total = Object.values(buckets).reduce((sum, value) => sum + value, 0);

  return {
    total,
    reported: buckets.reported,
    estimated: buckets['host-catalog'],
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